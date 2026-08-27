import { describe, expect, it, vi } from 'vitest'

import {
  createProviderPlaceDetailWorker,
  type IngestionStore,
  type ProviderPlaceDetailJobStore,
  type ProviderPlaceDetailSource,
} from '../index.js'

const at = '2026-08-28T03:00:00.000Z'
const claim = {
  jobId: '01993000-0000-7000-8000-000000000001',
  providerKey: 'naver' as const,
  providerPlaceId: 'naver-place-1',
  attemptCount: 1,
  observationId: '01993000-0000-7000-8000-000000000002',
  candidateId: '01993000-0000-7000-8000-000000000003',
  lease: {
    owner: 'provider-detail-worker',
    generation: 1,
    expiresAt: '2026-08-28T03:01:00.000Z',
  },
}

function fixture(source: ProviderPlaceDetailSource) {
  const appended: unknown[] = []
  const store: ProviderPlaceDetailJobStore = {
    claimNext: vi.fn(async () => claim),
    renewLease: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    finishFailure: vi.fn(async () => undefined),
  }
  const ingestionStore: IngestionStore = {
    append: vi.fn(async (record) => {
      appended.push(record)
      return 'recorded' as const
    }),
  }
  return { store, ingestionStore, source, appended }
}

function worker(dependencies: ReturnType<typeof fixture>) {
  return createProviderPlaceDetailWorker({
    workerId: 'provider-detail-worker',
    store: dependencies.store,
    ingestionStore: dependencies.ingestionStore,
    sources: [dependencies.source],
    now: () => new Date(at),
    leaseMilliseconds: 60_000,
    maximumAttempts: 3,
    retryDelayMilliseconds: () => 30_000,
  })
}

describe('provider place detail worker', () => {
  it('records normalized evidence without mutating a canonical place', async () => {
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(async () => ({
        kind: 'available' as const,
        detail: {
          acquisitionKind: 'structured-web' as const,
          payloadChecksum: 'a'.repeat(64),
          parserVersion: 'naver-place-detail.v1',
          observedAt: at,
          name: '검증 장소',
          address: '대한민국 서울특별시',
          categoryLabel: '공공기관',
          location: { latitude: 37.5665, longitude: 126.978 },
          attributes: { businessStatus: 'open' },
          confidence: 0.9,
        },
      })),
    }
    const dependencies = fixture(source)

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'completed',
      jobId: claim.jobId,
      observationId: claim.observationId,
    })

    expect(dependencies.appended).toEqual([
      expect.objectContaining({
        id: claim.observationId,
        kind: 'source-observation',
        observationKind: 'provider-detail',
        providerKey: 'naver',
        externalPlaceId: 'naver-place-1',
      }),
      expect.objectContaining({
        id: claim.candidateId,
        kind: 'place-candidate',
        sourceObservationId: claim.observationId,
        name: '검증 장소',
      }),
    ])
    expect(dependencies.store.complete).toHaveBeenCalledWith({
      claim,
      completedAt: at,
    })
  })

  it('schedules a bounded retry for a transient provider failure', async () => {
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(async () => ({
        kind: 'failure' as const,
        code: 'provider-rate-limited' as const,
        retryable: true,
      })),
    }
    const dependencies = fixture(source)

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'retry-scheduled',
      jobId: claim.jobId,
      code: 'provider-rate-limited',
    })
    expect(dependencies.appended).toEqual([])
    expect(dependencies.store.finishFailure).toHaveBeenCalledWith({
      claim,
      code: 'provider-rate-limited',
      retryable: true,
      retryAt: '2026-08-28T03:00:30.000Z',
      finishedAt: at,
    })
  })
})
