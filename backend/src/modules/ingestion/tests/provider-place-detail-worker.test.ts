import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createProviderPlaceDetailWorker,
  type IngestionStore,
  type ProviderPlaceDetailJobStore,
  type ProviderPlaceDetailResult,
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

const availableDetail = {
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
}

function fixture(source: ProviderPlaceDetailSource) {
  const appended: unknown[] = []
  const store: ProviderPlaceDetailJobStore = {
    scheduleStale: vi.fn(async () => 0),
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

function worker(
  dependencies: ReturnType<typeof fixture>,
  options: Readonly<{
    now?: () => Date
    leaseMilliseconds?: number
    maximumAttempts?: number
  }> = {},
) {
  return createProviderPlaceDetailWorker({
    workerId: 'provider-detail-worker',
    store: dependencies.store,
    ingestionStore: dependencies.ingestionStore,
    sources: [dependencies.source],
    now: options.now ?? (() => new Date(at)),
    leaseMilliseconds: options.leaseMilliseconds ?? 60_000,
    maximumAttempts: options.maximumAttempts ?? 3,
    retryBaseMilliseconds: 30_000,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('provider place detail worker', () => {
  it('records normalized evidence without mutating a canonical place', async () => {
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(async () => availableDetail),
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
    const retryClaim = {
      ...claim,
      attemptCount: 2,
    }
    vi.mocked(dependencies.store.claimNext).mockResolvedValue(retryClaim)

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'retry-scheduled',
      jobId: claim.jobId,
      code: 'provider-rate-limited',
    })
    expect(dependencies.appended).toEqual([])
    expect(dependencies.store.finishFailure).toHaveBeenCalledWith({
      claim: retryClaim,
      code: 'provider-rate-limited',
      retryable: true,
      retryAt: '2026-08-28T03:01:00.000Z',
      finishedAt: at,
    })
  })

  it('caps exponential retry backoff at fifteen minutes', async () => {
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(async () => ({
        kind: 'failure' as const,
        code: 'provider-unavailable' as const,
        retryable: true,
      })),
    }
    const dependencies = fixture(source)
    const lateClaim = { ...claim, attemptCount: 20 }
    vi.mocked(dependencies.store.claimNext).mockResolvedValue(lateClaim)
    const run = worker(dependencies, { maximumAttempts: 30 })

    await run.runOne()

    expect(dependencies.store.finishFailure).toHaveBeenCalledWith({
      claim: lateClaim,
      code: 'provider-unavailable',
      retryable: true,
      retryAt: '2026-08-28T03:15:00.000Z',
      finishedAt: at,
    })
  })

  it('renews the lease while provider acquisition is running', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
    let resolveFetch!: (value: typeof availableDetail) => void
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(() => new Promise<ProviderPlaceDetailResult>((resolve) => {
        resolveFetch = resolve
      })),
    }
    const dependencies = fixture(source)
    const run = worker(dependencies, {
      now: () => new Date(Date.now()),
      leaseMilliseconds: 9_000,
    })

    const running = run.runOne()
    await vi.advanceTimersByTimeAsync(0)
    expect(dependencies.store.renewLease).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(dependencies.store.renewLease).toHaveBeenCalledTimes(2)
    expect(dependencies.store.renewLease).toHaveBeenLastCalledWith({
      claim,
      renewedAt: '2026-08-28T03:00:03.000Z',
      leaseUntil: '2026-08-28T03:00:12.000Z',
    })

    resolveFetch(availableDetail)
    await expect(running).resolves.toMatchObject({ status: 'completed' })
  })

  it('aborts provider acquisition and avoids terminal writes when a heartbeat loses the lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
    let fetchSignal: AbortSignal | undefined
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(({ signal }) => {
        fetchSignal = signal
        return new Promise<ProviderPlaceDetailResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }),
    }
    const dependencies = fixture(source)
    vi.mocked(dependencies.store.renewLease)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const run = worker(dependencies, {
      now: () => new Date(Date.now()),
      leaseMilliseconds: 9_000,
    })

    const running = run.runOne()
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(running).resolves.toEqual({
      status: 'lease-lost',
      jobId: claim.jobId,
    })
    expect(fetchSignal?.aborted).toBe(true)
    expect(dependencies.appended).toEqual([])
    expect(dependencies.store.complete).not.toHaveBeenCalled()
    expect(dependencies.store.finishFailure).not.toHaveBeenCalled()
  })

  it('does not write evidence when the final fencing renewal loses ownership', async () => {
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(async () => availableDetail),
    }
    const dependencies = fixture(source)
    vi.mocked(dependencies.store.renewLease)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await expect(worker(dependencies).runOne()).resolves.toEqual({
      status: 'lease-lost',
      jobId: claim.jobId,
    })
    expect(dependencies.appended).toEqual([])
    expect(dependencies.store.complete).not.toHaveBeenCalled()
    expect(dependencies.store.finishFailure).not.toHaveBeenCalled()
  })

  it('propagates process cancellation to an active provider fetch', async () => {
    const process = new AbortController()
    let fetchSignal: AbortSignal | undefined
    const source: ProviderPlaceDetailSource = {
      providerKey: 'naver',
      fetch: vi.fn(({ signal }) => {
        fetchSignal = signal
        return new Promise<ProviderPlaceDetailResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }),
    }
    const dependencies = fixture(source)

    const running = worker(dependencies).runOne(process.signal)
    await vi.waitFor(() => expect(source.fetch).toHaveBeenCalledOnce())
    process.abort()

    await expect(running).resolves.toEqual({
      status: 'aborted',
      jobId: claim.jobId,
    })
    expect(fetchSignal?.aborted).toBe(true)
    expect(dependencies.store.complete).not.toHaveBeenCalled()
    expect(dependencies.store.finishFailure).not.toHaveBeenCalled()
  })
})
