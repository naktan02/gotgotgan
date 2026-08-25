import { describe, expect, it, vi } from 'vitest'

import {
  createPlaceSuggestionMaterialization,
  createPlaceSuggestionSelection,
  createPlaceSuggestions,
  type PlaceSuggestionCandidate,
  type PlaceSuggestionSource,
  type PlaceSuggestionStore,
  type StoredPlaceSuggestion,
  type SuggestionImpression,
  type SuggestionSession,
} from '../index.js'

const now = () => new Date('2026-08-26T10:00:00.000Z')

function candidate(
  candidateKey: string,
  sourceKey: 'local' | 'google',
  name: string,
): PlaceSuggestionCandidate {
  return {
    candidateKey,
    identity: sourceKey === 'local'
      ? { kind: 'canonical', placeId: '01992d20-1000-7000-8000-000000000101' }
      : { kind: 'provider', providerKey: 'google', providerPlaceId: candidateKey },
    source: {
      key: sourceKey,
      label: sourceKey === 'local' ? 'Place' : 'Google Maps',
      detailsAvailable: sourceKey !== 'local',
      attributions: sourceKey === 'local' ? [] : [{ label: 'Google Maps' }],
    },
    name,
    areaLabel: sourceKey === 'local' ? '서울 성동구' : 'Fukuoka, Japan',
    location: sourceKey === 'local' ? { latitude: 37.5445, longitude: 127.056 } : null,
    categoryLabel: '라멘',
    observedAt: '2026-08-26T10:00:00.000Z',
  }
}

class MemorySuggestionStore implements PlaceSuggestionStore {
  readonly sessions = new Map<string, SuggestionSession>()
  readonly suggestions = new Map<string, StoredPlaceSuggestion>()

  async openSession(input: Readonly<{
    requestedSessionId?: string
    newSession: SuggestionSession
    now: string
  }>): Promise<SuggestionSession> {
    const prior = input.requestedSessionId === undefined
      ? undefined
      : this.sessions.get(input.requestedSessionId)
    const session = prior !== undefined && prior.expiresAt > input.now ? prior : input.newSession
    this.sessions.set(session.id, session)
    return session
  }

  async recordImpressions(input: Readonly<{
    sessionId: string
    impressions: readonly SuggestionImpression[]
  }>): Promise<readonly StoredPlaceSuggestion[]> {
    return input.impressions.map((impression) => {
      const prior = [...this.suggestions.values()].find((stored) =>
        stored.sessionId === input.sessionId &&
        stored.candidate.candidateKey === impression.candidate.candidateKey)
      const stored = prior ?? { ...impression, sessionId: input.sessionId }
      this.suggestions.set(stored.suggestionId, stored)
      return stored
    })
  }

  async select(suggestionId: string, selectedAt: string) {
    const suggestion = this.suggestions.get(suggestionId)
    if (suggestion === undefined || suggestion.expiresAt <= selectedAt) return undefined
    const first = suggestion.selectedAt === undefined
    const selected = first ? { ...suggestion, selectedAt } : suggestion
    this.suggestions.set(suggestionId, selected)
    return { status: first ? 'recorded' as const : 'replayed' as const, suggestion: selected }
  }

  async markMaterialized(): Promise<'recorded' | 'replayed'> {
    return 'recorded'
  }

  async cleanupExpired(): Promise<Readonly<{ sessions: number; suggestions: number; discoveries: number }>> {
    return { sessions: 0, suggestions: 0, discoveries: 0 }
  }
}

describe('Place suggestion interface', () => {
  it('merges independent sources, isolates failure, and persists impressions in one reusable session', async () => {
    const store = new MemorySuggestionStore()
    const observedSessions: string[] = []
    const local: PlaceSuggestionSource = {
      sourceKey: 'local',
      suggest: async (query) => {
        observedSessions.push(query.sessionId)
        return { status: 'complete', items: [candidate('local:ramen', 'local', '성수 라멘 연구소')] }
      },
    }
    const google: PlaceSuggestionSource = {
      sourceKey: 'google',
      suggest: async (query) => {
        observedSessions.push(query.sessionId)
        return { status: 'complete', items: [candidate('google-place-100', 'google', 'Senkai Ramen')] }
      },
    }
    const unavailable: PlaceSuggestionSource = {
      sourceKey: 'unavailable',
      suggest: async () => { throw new Error('private provider failure') },
    }
    const ids = [
      '01992d20-1000-7000-8000-000000000001',
      '01992d20-1000-7000-8000-000000000002',
      '01992d20-1000-7000-8000-000000000003',
      '01992d20-1000-7000-8000-000000000004',
      '01992d20-1000-7000-8000-000000000005',
      '01992d20-1000-7000-8000-000000000006',
      '01992d20-1000-7000-8000-000000000007',
      '01992d20-1000-7000-8000-000000000008',
      '01992d20-1000-7000-8000-000000000009',
    ]
    const suggest = createPlaceSuggestions({
      sources: [local, google, unavailable], store, now, nextId: () => ids.shift()!,
    })

    const first = await suggest({ query: '센카이', limit: 8 })
    const second = await suggest({ query: '센카이 라멘', limit: 8, sessionId: first.sessionId })

    expect(first.items.map((item) => item.name)).toEqual(['성수 라멘 연구소', 'Senkai Ramen'])
    expect(first.sources).toEqual([
      { sourceKey: 'local', status: 'complete', resultCount: 1 },
      { sourceKey: 'google', status: 'complete', resultCount: 1 },
      {
        sourceKey: 'unavailable', status: 'unavailable', resultCount: 0,
        errorCode: 'PLACE_SUGGESTION_SOURCE_UNAVAILABLE',
      },
    ])
    expect(second.sessionId).toBe(first.sessionId)
    expect(observedSessions).toEqual([first.sessionId, first.sessionId, first.sessionId, first.sessionId])
    expect(store.suggestions.size).toBe(2)
    expect(JSON.stringify(first)).not.toContain('private provider failure')
  })

  it('records provider selection idempotently while canonical selection creates no observation', async () => {
    const store = new MemorySuggestionStore()
    const provider = candidate('google-place-100', 'google', 'Senkai Ramen')
    const canonical = candidate('local:ramen', 'local', '성수 라멘 연구소')
    const session: SuggestionSession = {
      id: '01992d20-1000-7000-8000-000000000001',
      createdAt: '2026-08-26T10:00:00.000Z',
      expiresAt: '2026-08-26T10:10:00.000Z',
    }
    store.sessions.set(session.id, session)
    const providerSuggestion: StoredPlaceSuggestion = {
      sessionId: session.id,
      suggestionId: '01992d20-1000-7000-8000-000000000002',
      observationId: '01992d20-1000-7000-8000-000000000003',
      candidateId: '01992d20-1000-7000-8000-000000000004',
      decisionId: '01992d20-1000-7000-8000-000000000005',
      proposedPlaceId: '01992d20-1000-7000-8000-000000000006',
      candidate: provider,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }
    const canonicalSuggestion: StoredPlaceSuggestion = {
      sessionId: session.id,
      suggestionId: '01992d20-1000-7000-8000-000000000007',
      candidate: canonical,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }
    store.suggestions.set(providerSuggestion.suggestionId, providerSuggestion)
    store.suggestions.set(canonicalSuggestion.suggestionId, canonicalSuggestion)
    const recordObservation = vi.fn(async (_input: unknown) => 'recorded' as const)
    const select = createPlaceSuggestionSelection({ store, recordObservation, now })

    const first = await select(providerSuggestion.suggestionId)
    const replay = await select(providerSuggestion.suggestionId)
    const local = await select(canonicalSuggestion.suggestionId)

    expect(first).toMatchObject({ status: 'recorded', observationId: providerSuggestion.observationId })
    expect(replay).toMatchObject({ status: 'replayed', observationId: providerSuggestion.observationId })
    expect(local).toMatchObject({ status: 'canonical' })
    expect(recordObservation).toHaveBeenCalledTimes(2)
    expect(recordObservation.mock.calls[0]?.[0]).toMatchObject({
      observationId: providerSuggestion.observationId,
      providerKey: 'google',
      externalPlaceId: 'google-place-100',
    })
  })

  it('promotes personal intent through one injected materialization interface', async () => {
    const store = new MemorySuggestionStore()
    const sessionId = '01992d20-1000-7000-8000-000000000001'
    const stored: StoredPlaceSuggestion = {
      sessionId,
      suggestionId: '01992d20-1000-7000-8000-000000000002',
      observationId: '01992d20-1000-7000-8000-000000000003',
      candidateId: '01992d20-1000-7000-8000-000000000004',
      decisionId: '01992d20-1000-7000-8000-000000000005',
      proposedPlaceId: '01992d20-1000-7000-8000-000000000006',
      candidate: candidate('google-place-100', 'google', 'Senkai Ramen'),
      createdAt: '2026-08-26T10:00:00.000Z',
      expiresAt: '2026-08-26T10:10:00.000Z',
    }
    store.sessions.set(sessionId, {
      id: sessionId,
      createdAt: '2026-08-26T10:00:00.000Z',
      expiresAt: stored.expiresAt,
    })
    store.suggestions.set(stored.suggestionId, stored)
    const materialize = vi.fn(async () => ({
      status: 'created' as const,
      canonicalPlaceId: stored.proposedPlaceId!,
    }))
    const promote = createPlaceSuggestionMaterialization({ store, materialize, now })

    await expect(promote(stored.suggestionId, 'save')).resolves.toEqual({
      schemaVersion: 'place-suggestion-materialization.v1',
      suggestionId: stored.suggestionId,
      status: 'created',
      canonicalPlaceId: stored.proposedPlaceId,
    })
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'save',
      observationId: stored.observationId,
      candidateId: stored.candidateId,
      decisionId: stored.decisionId,
      proposedPlaceId: stored.proposedPlaceId,
    }))
  })
})
