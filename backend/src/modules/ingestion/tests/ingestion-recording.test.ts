import { describe, expect, it } from 'vitest'

import {
  recordPlaceCandidate,
  recordResolutionDecision,
  recordSourceObservation,
  type IngestionRecord,
  type IngestionStore,
} from '../index.js'

class MemoryIngestionStore implements IngestionStore {
  readonly records = new Map<string, IngestionRecord>()

  async append(record: IngestionRecord) {
    const existing = this.records.get(record.id)
    if (existing === undefined) {
      this.records.set(record.id, record)
      return 'recorded' as const
    }
    return existing.fingerprint === record.fingerprint ? 'replayed' as const : 'conflict' as const
  }
}

describe('provider-neutral ingestion recording', () => {
  it('records one immutable source observation and accepts an identical replay', async () => {
    const store = new MemoryIngestionStore()
    const input = {
      id: '01992a10-50d5-71a3-a79b-d9940d4a882d',
      providerKey: 'naver',
      externalPlaceId: 'provider-place-42',
      acquisitionKind: 'structured-web' as const,
      payloadChecksum: 'a'.repeat(64),
      parserVersion: 'naver-place-v1',
      observedAt: '2026-08-26T01:00:00.000Z',
      acquiredAt: '2026-08-26T01:00:01.000Z',
      facts: { name: '라멘집', coordinates: { latitude: 37.544, longitude: 127.056 } },
      confidence: 0.9,
      store,
    }

    await expect(recordSourceObservation(input)).resolves.toEqual({ status: 'recorded' })
    await expect(recordSourceObservation(input)).resolves.toEqual({ status: 'replayed' })
  })

  it('records a normalized candidate without treating it as canonical truth', async () => {
    const store = new MemoryIngestionStore()
    await expect(recordPlaceCandidate({
      id: '01992a11-25be-7bc0-8e8c-a4c24b083784',
      sourceObservationId: '01992a10-50d5-71a3-a79b-d9940d4a882d',
      parserVersion: 'canonical-normalizer-v1',
      name: '라멘집',
      address: '서울 성동구',
      location: { latitude: 37.544, longitude: 127.056 },
      attributes: { providerCategory: '일본식라면' },
      createdAt: '2026-08-26T01:00:02.000Z',
      store,
    })).resolves.toEqual({ status: 'recorded' })

    expect([...store.records.values()]).toEqual([
      expect.objectContaining({ kind: 'place-candidate', sourceObservationId: expect.any(String) }),
    ])
  })

  it('records review and canonical-change decisions with explicit evidence', async () => {
    const store = new MemoryIngestionStore()
    const result = await recordResolutionDecision({
      id: '01992a12-aa70-79c0-9d28-0a175fd4310d',
      candidateId: '01992a11-25be-7bc0-8e8c-a4c24b083784',
      decision: { kind: 'link-place', canonicalPlaceId: '01992a13-49d7-754b-8587-747e91e638bc' },
      decidedBy: { kind: 'policy', reference: 'resolution-policy-v1' },
      evidenceObservationIds: ['01992a10-50d5-71a3-a79b-d9940d4a882d'],
      rationale: 'same provider identity and coordinate',
      decidedAt: '2026-08-26T01:00:03.000Z',
      store,
    })

    expect(result).toEqual({ status: 'recorded' })
    expect([...store.records.values()][0]).toEqual(expect.objectContaining({
      kind: 'resolution-decision',
      decision: { kind: 'link-place', canonicalPlaceId: expect.any(String) },
    }))
  })

  it('records a merge decision without inventing a Place candidate', async () => {
    const store = new MemoryIngestionStore()
    await expect(recordResolutionDecision({
      id: '01992a14-7241-7fd4-b7bf-cf4140f573ed',
      decision: {
        kind: 'merge-places',
        sourceCanonicalPlaceId: '01992a13-49d7-754b-8587-747e91e638bc',
        targetCanonicalPlaceId: '01992a15-2a3d-7f92-bf08-872d42fe5d0b',
      },
      decidedBy: { kind: 'reviewer', reference: 'membership-reviewer-1' },
      evidenceObservationIds: ['01992a10-50d5-71a3-a79b-d9940d4a882d'],
      rationale: 'review confirmed both provider listings identify the same place',
      decidedAt: '2026-08-26T01:00:04.000Z',
      store,
    })).resolves.toEqual({ status: 'recorded' })
  })

  it('rejects reuse of an id for different evidence', async () => {
    const store = new MemoryIngestionStore()
    const base = {
      id: '01992a10-50d5-71a3-a79b-d9940d4a882d',
      providerKey: 'naver',
      externalPlaceId: 'provider-place-42',
      acquisitionKind: 'structured-web' as const,
      payloadChecksum: 'a'.repeat(64),
      parserVersion: 'naver-place-v1',
      observedAt: '2026-08-26T01:00:00.000Z',
      acquiredAt: '2026-08-26T01:00:01.000Z',
      facts: { name: '라멘집' },
      confidence: 0.9,
      store,
    }
    await recordSourceObservation(base)
    await expect(recordSourceObservation({ ...base, payloadChecksum: 'b'.repeat(64) }))
      .rejects.toMatchObject({ name: 'IngestionIdConflictError' })
  })
})
