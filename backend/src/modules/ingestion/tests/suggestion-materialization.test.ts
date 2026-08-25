import { describe, expect, it, vi } from 'vitest'

import {
  materializeSuggestedPlace,
  recordSuggestionObservation,
  type CanonicalPlaceMaterializationPort,
  type IngestionRecord,
  type IngestionStore,
} from '../index.js'

const input = {
  intent: 'save' as const,
  observationId: '01992d20-3000-7000-8000-000000000001',
  candidateId: '01992d20-3000-7000-8000-000000000002',
  decisionId: '01992d20-3000-7000-8000-000000000003',
  proposedPlaceId: '01992d20-3000-7000-8000-000000000004',
  providerKey: 'google',
  externalPlaceId: 'google-place-100',
  providerPlaceId: 'google-place-100',
  name: 'Senkai Ramen',
  areaLabel: 'Fukuoka, Japan',
  categoryLabel: 'Ramen restaurant',
  location: null,
  sourceKey: 'google',
  observedAt: '2026-08-26T10:00:00.000Z',
  acquiredAt: '2026-08-26T10:02:00.000Z',
}

function recordingStore(records: IngestionRecord[]): IngestionStore {
  return {
    append: async (record) => {
      const prior = records.find((item) => item.id === record.id)
      if (prior !== undefined) return prior.fingerprint === record.fingerprint ? 'replayed' : 'conflict'
      records.push(record)
      return 'recorded'
    },
  }
}

describe('interactive suggestion ingestion', () => {
  it('records normalized selection evidence without treating it as canonical truth', async () => {
    const records: IngestionRecord[] = []

    await expect(recordSuggestionObservation(input, recordingStore(records))).resolves.toEqual({
      status: 'recorded',
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'source-observation',
      id: input.observationId,
      providerKey: 'google',
      externalPlaceId: 'google-place-100',
      acquisitionKind: 'documented-api',
      parserVersion: 'place-suggestion.v1',
      facts: {
        name: 'Senkai Ramen', areaLabel: 'Fukuoka, Japan', location: null,
      },
    })
  })

  it('records candidate and decision before applying a separately idempotent canonical command', async () => {
    const records: IngestionRecord[] = []
    const canonical: CanonicalPlaceMaterializationPort = {
      resolveProviderIdentity: vi.fn(async () => ({ status: 'not-found' as const })),
      apply: vi.fn(async () => ({ status: 'applied' as const })),
    }

    const result = await materializeSuggestedPlace({
      input,
      ingestionStore: recordingStore(records),
      canonical,
    })

    expect(result).toEqual({ status: 'created', canonicalPlaceId: input.proposedPlaceId })
    expect(records.map((record) => record.kind)).toEqual([
      'source-observation', 'place-candidate', 'resolution-decision',
    ])
    expect(canonical.apply).toHaveBeenCalledWith({
      decisionId: input.decisionId,
      sourceDecisionId: input.decisionId,
      command: {
        kind: 'create-place',
        placeId: input.proposedPlaceId,
        providerIdentity: { providerKey: 'google', externalPlaceId: 'google-place-100' },
      },
      policyVersion: 'interactive-suggestion-materialization.v1',
      occurredAt: input.acquiredAt,
    })
  })
})
