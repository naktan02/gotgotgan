import type { PlaceSuggestionSource } from './ports/place-suggestion-source.js'
import type { PlaceSuggestionStore } from './ports/place-suggestion-store.js'
import {
  assertSuggestionCandidate,
  InvalidPlaceSuggestionError,
  type PlaceSuggestion,
  type PlaceSuggestionCandidate,
  type PlaceSuggestionQuery,
  type PlaceSuggestionsPage,
  type SuggestionImpression,
} from '../domain/suggestions.js'

const sessionTtlMilliseconds = 10 * 60 * 1_000
const suggestionTtlMilliseconds = 15 * 60 * 1_000

function candidateIdentity(candidate: PlaceSuggestionCandidate): string {
  return candidate.identity.kind === 'canonical'
    ? `canonical:${candidate.identity.placeId}`
    : candidate.identity.providerPlaceId === undefined
      ? `provider:${candidate.identity.providerKey}:${candidate.candidateKey}`
      : `provider:${candidate.identity.providerKey}:${candidate.identity.providerPlaceId}`
}

function mergeRoundRobin(
  batches: readonly Readonly<{ items: readonly PlaceSuggestionCandidate[] }>[],
  limit: number,
): readonly PlaceSuggestionCandidate[] {
  const merged: PlaceSuggestionCandidate[] = []
  const seen = new Set<string>()
  const maximumLength = Math.max(0, ...batches.map((batch) => batch.items.length))
  for (let index = 0; index < maximumLength; index += 1) {
    for (const batch of batches) {
      const candidate = batch.items[index]
      if (candidate === undefined) continue
      const identity = candidateIdentity(candidate)
      if (seen.has(identity)) continue
      seen.add(identity)
      merged.push(candidate)
      if (merged.length === limit) return merged
    }
  }
  return merged
}

function publicSuggestion(stored: Readonly<{
  suggestionId: string
  candidate: PlaceSuggestionCandidate
}>): PlaceSuggestion {
  const { candidateKey: _, ...candidate } = stored.candidate
  return { suggestionId: stored.suggestionId, ...candidate }
}

export function createPlaceSuggestions(dependencies: Readonly<{
  sources: readonly PlaceSuggestionSource[]
  store: PlaceSuggestionStore
  nextId: () => string
  now?: () => Date
}>): (query: PlaceSuggestionQuery) => Promise<PlaceSuggestionsPage> {
  const sourceKeys = dependencies.sources.map((source) => source.sourceKey)
  if (sourceKeys.length === 0 || new Set(sourceKeys).size !== sourceKeys.length) {
    throw new InvalidPlaceSuggestionError('Place suggestion source keys must be present and unique.')
  }
  const now = dependencies.now ?? (() => new Date())

  return async (query) => {
    const normalizedQuery = query.query.normalize('NFKC').replace(/\s+/g, ' ').trim()
    if (normalizedQuery.length === 0 || normalizedQuery.length > 200 || query.limit < 1 || query.limit > 12) {
      throw new InvalidPlaceSuggestionError('Place suggestion query is invalid.')
    }
    const timestamp = now()
    const openedAt = timestamp.toISOString()
    const session = await dependencies.store.openSession({
      ...(query.sessionId === undefined ? {} : { requestedSessionId: query.sessionId }),
      newSession: {
        id: dependencies.nextId(),
        createdAt: openedAt,
        expiresAt: new Date(timestamp.getTime() + sessionTtlMilliseconds).toISOString(),
      },
      now: openedAt,
    })
    await dependencies.store.cleanupExpired(openedAt, 100)
    const settled = await Promise.all(dependencies.sources.map(async (source) => {
      try {
        const batch = await source.suggest({
          query: normalizedQuery,
          sessionId: session.id,
          limit: query.limit,
          ...(query.bounds === undefined ? {} : { bounds: query.bounds }),
          ...(query.areaText === undefined ? {} : { areaText: query.areaText }),
          ...(query.language === undefined ? {} : { language: query.language }),
        })
        batch.items.forEach(assertSuggestionCandidate)
        return {
          sourceKey: source.sourceKey,
          batch,
          outcome: {
            sourceKey: source.sourceKey,
            status: batch.status,
            resultCount: batch.items.length,
            ...(batch.errorCode === undefined ? {} : { errorCode: batch.errorCode }),
          },
        } as const
      } catch {
        return {
          sourceKey: source.sourceKey,
          batch: {
            status: 'unavailable' as const,
            items: [],
            errorCode: 'PLACE_SUGGESTION_SOURCE_UNAVAILABLE',
          },
          outcome: {
            sourceKey: source.sourceKey,
            status: 'unavailable' as const,
            resultCount: 0,
            errorCode: 'PLACE_SUGGESTION_SOURCE_UNAVAILABLE',
          },
        } as const
      }
    }))
    const candidates = mergeRoundRobin(settled.map((result) => result.batch), query.limit)
    const expiresAt = new Date(timestamp.getTime() + suggestionTtlMilliseconds).toISOString()
    const impressions: SuggestionImpression[] = candidates.map((candidate) => ({
      suggestionId: dependencies.nextId(),
      candidate,
      createdAt: openedAt,
      expiresAt,
      ...(candidate.identity.kind === 'canonical' ? {} : {
        observationId: dependencies.nextId(),
        candidateId: dependencies.nextId(),
        decisionId: dependencies.nextId(),
        proposedPlaceId: dependencies.nextId(),
      }),
    }))
    const stored = await dependencies.store.recordImpressions({
      sessionId: session.id,
      impressions,
    })
    return {
      schemaVersion: 'place-suggestions.v1',
      sessionId: session.id,
      items: stored.map(publicSuggestion),
      sources: settled.map((result) => result.outcome),
    }
  }
}
