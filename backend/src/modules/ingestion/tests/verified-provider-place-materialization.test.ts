import { describe, expect, it, vi } from 'vitest'

import {
  materializeVerifiedProviderPlace,
  materializeSnapshotProviderPlace,
  VerifiedProviderPlaceMaterializationRejectedError,
  type CanonicalPlaceMaterializationPort,
  type IngestionRecord,
  type IngestionStore,
} from '../index.js'

const evidence = {
  decisionId: '01992d20-3000-7000-8000-000000000013',
  proposedPlaceId: '01992d20-3000-7000-8000-000000000014',
  providerKey: 'naver',
  externalPlaceId: 'naver-place-1',
  sourceObservationId: '01992d20-3000-7000-8000-000000000011',
  placeCandidateId: '01992d20-3000-7000-8000-000000000012',
  occurredAt: '2026-09-03T00:00:02.000Z',
  policyReference: 'transfer-verified-provider-detail-policy-create.v1',
  rationale: 'approved-import:server-verified-provider-detail',
}

function recordingStore(records: IngestionRecord[]): IngestionStore {
  return {
    append: async (record) => {
      const prior = records.find((item) => item.id === record.id)
      if (prior === undefined) {
        records.push(record)
        return 'recorded'
      }
      return prior.fingerprint === record.fingerprint ? 'replayed' : 'conflict'
    },
  }
}

describe('verified Provider place materialization', () => {
  it('records and replays minimum bookmark evidence without detail or coordinates', async () => {
    const records: IngestionRecord[] = []
    const canonical: CanonicalPlaceMaterializationPort = {
      apply: vi.fn(async () => ({ status: 'identity-already-linked' as const })),
      resolveProviderIdentity: vi.fn(async () => ({
        status: 'linked' as const, placeId: evidence.proposedPlaceId,
      })),
    }
    const input = {
      evidence: { ...evidence, policyReference: 'transfer-source-snapshot-policy-create.v1' },
      snapshot: {
        acquisitionKind: 'browser-network' as const,
        parserVersion: 'saved-place.v1', payloadChecksum: 'c'.repeat(64),
        observedAt: '2026-09-03T00:00:00.000Z', acquiredAt: '2026-09-03T00:00:01.000Z',
        name: '롯데월드', address: null, categoryLabel: '놀이공원', location: null,
      },
      ingestionStore: recordingStore(records), canonical,
    }
    await materializeSnapshotProviderPlace(input)
    await materializeSnapshotProviderPlace(input)
    expect(records.map((record) => record.kind)).toEqual([
      'source-observation', 'place-candidate', 'resolution-decision',
    ])
    expect(records[0]).toMatchObject({ observationKind: 'general', facts: { name: '롯데월드' } })
    expect(records[1]).not.toHaveProperty('location')
  })

  it('records a decision over existing verified detail evidence before creating', async () => {
    const records: IngestionRecord[] = []
    const canonical: CanonicalPlaceMaterializationPort = {
      apply: vi.fn(async () => {
        expect(records.map((record) => record.kind)).toEqual(['resolution-decision'])
        return { status: 'applied' as const }
      }),
      resolveProviderIdentity: vi.fn(async () => ({
        status: 'linked' as const, placeId: evidence.proposedPlaceId,
      })),
    }

    await expect(materializeVerifiedProviderPlace({
      evidence, ingestionStore: recordingStore(records), canonical,
    })).resolves.toEqual({ status: 'created', canonicalPlaceId: evidence.proposedPlaceId })
    expect(records[0]).toMatchObject({
      candidateId: evidence.placeCandidateId,
      evidenceObservationIds: [evidence.sourceObservationId],
    })
  })

  it('reuses the identity winner when another operation wins the race', async () => {
    const winner = '01992d20-3000-7000-8000-000000000015'
    const canonical: CanonicalPlaceMaterializationPort = {
      apply: vi.fn(async () => ({ status: 'identity-already-linked' as const })),
      resolveProviderIdentity: vi.fn(async () => ({ status: 'linked' as const, placeId: winner })),
    }

    await expect(materializeVerifiedProviderPlace({
      evidence, ingestionStore: recordingStore([]), canonical,
    })).resolves.toEqual({ status: 'linked', canonicalPlaceId: winner })
  })

  it('rejects permanent canonical conflicts instead of inviting an endless retry', async () => {
    const canonical: CanonicalPlaceMaterializationPort = {
      apply: vi.fn(async () => ({ status: 'conflict' as const })),
      resolveProviderIdentity: vi.fn(),
    }

    await expect(materializeVerifiedProviderPlace({
      evidence, ingestionStore: recordingStore([]), canonical,
    })).rejects.toBeInstanceOf(VerifiedProviderPlaceMaterializationRejectedError)
  })
})
