import { describe, expect, it, vi } from 'vitest'

import type { ProviderPlaceDetailJobStore } from '../../modules/ingestion/index.js'
import type { ForgeRecipeClient } from '../../modules/providers/index.js'
import {
  runProviderPlaceDetails,
  type ProviderDetailConfig,
} from './provider-place-detail-runtime.js'

const config: ProviderDetailConfig = {
  database: {
    connectionString: 'postgresql://place:secret@database/place',
    maxConnections: 2,
    idleTimeoutMilliseconds: 10_000,
    connectionTimeoutMilliseconds: 3_000,
  },
  idleMilliseconds: 100,
  leaseMilliseconds: 60_000,
  freshnessMilliseconds: 604_800_000,
  maximumAttempts: 3,
  maximumJobs: 10,
  refreshBatchSize: 100,
  retryBaseMilliseconds: 30_000,
  traceforge: {
    naverPackFile: 'C:\\fixture\\naver-pack.json',
    naverPackVersion: '0.2.0',
    profileRoot: 'C:\\fixture\\profiles',
    runnerFile: 'C:\\fixture\\runner.js',
  },
}

describe('Provider place detail runtime', () => {
  it('uses the released SDK seam and always closes its client before resources', async () => {
    const cleanupOrder: string[] = []
    const closeClient = vi.fn(async () => undefined)
    const closeResources = vi.fn(async () => undefined)
    const client: ForgeRecipeClient & { close(): Promise<void> } = {
      close: closeClient,
      run: vi.fn(async () => ({
        outputs: { address: '서울', name: '검증 장소' },
        state: 'succeeded' as const,
        version: 1 as const,
      })),
    }
    const store: ProviderPlaceDetailJobStore = {
      scheduleStale: vi.fn(async () => 0),
      claimNext: vi.fn(async () => undefined),
      renewLease: vi.fn(async () => true),
      complete: vi.fn(async () => undefined),
      finishFailure: vi.fn(async () => undefined),
    }

    await expect(runProviderPlaceDetails(config, { continuous: false }, {
      createClient: async () => ({
        ...client,
        close: vi.fn(async () => {
          cleanupOrder.push('client')
          await closeClient()
        }),
      }),
      createResources: async () => ({
        close: async () => {
          cleanupOrder.push('resources')
          await closeResources()
        },
        ingestionStore: { append: vi.fn(async () => 'recorded' as const) },
        store,
      }),
      workerId: 'provider-detail-worker',
    })).resolves.toEqual({ processed: 0, scheduled: 0, stopped: 'idle' })
    expect(closeClient).toHaveBeenCalledOnce()
    expect(closeResources).toHaveBeenCalledOnce()
    expect(cleanupOrder).toEqual(['client', 'resources'])
  })

  it('completes one pending Job through Forge output and the existing observation pipeline', async () => {
    const closeClient = vi.fn(async () => undefined)
    const closeResources = vi.fn(async () => undefined)
    const client: ForgeRecipeClient & { close(): Promise<void> } = {
      close: closeClient,
      run: vi.fn(async () => ({
        outputs: {
          address: '서울 중구',
          name: '검증 장소',
          phone: '02-1234-5678복사',
        },
        state: 'succeeded' as const,
        version: 1 as const,
      })),
    }
    const claim = {
      attemptCount: 1,
      candidateId: '01993000-0000-7000-8000-000000000003',
      jobId: '01993000-0000-7000-8000-000000000001',
      lease: {
        expiresAt: '2026-09-02T00:01:00.000Z',
        generation: 1,
        owner: 'provider-detail-worker',
      },
      observationId: '01993000-0000-7000-8000-000000000002',
      providerKey: 'naver' as const,
      providerPlaceId: '31806828',
    }
    const store: ProviderPlaceDetailJobStore = {
      scheduleStale: vi.fn(async () => 0),
      claimNext: vi.fn()
        .mockResolvedValueOnce(claim)
        .mockResolvedValueOnce(undefined),
      renewLease: vi.fn(async () => true),
      complete: vi.fn(async () => undefined),
      finishFailure: vi.fn(async () => undefined),
    }
    const append = vi.fn(async () => 'recorded' as const)

    await expect(runProviderPlaceDetails(config, { continuous: false }, {
      createClient: async () => client,
      createResources: async () => ({
        close: closeResources,
        ingestionStore: { append },
        store,
      }),
      now: () => new Date('2026-09-02T00:00:00.000Z'),
      workerId: 'provider-detail-worker',
    })).resolves.toEqual({ processed: 1, scheduled: 0, stopped: 'idle' })
    expect(append).toHaveBeenCalledTimes(2)
    expect(append).toHaveBeenNthCalledWith(1, expect.objectContaining({
      acquisitionKind: 'browser-dom',
      externalPlaceId: '31806828',
      kind: 'source-observation',
      observationKind: 'provider-detail',
      providerKey: 'naver',
    }))
    expect(store.complete).toHaveBeenCalledWith({
      claim,
      completedAt: '2026-09-02T00:00:00.000Z',
    })
    expect(store.scheduleStale).toHaveBeenCalledWith({
      providerKeys: ['naver'],
      staleBefore: '2026-08-26T00:00:00.000Z',
      scheduledAt: '2026-09-02T00:00:00.000Z',
      limit: 100,
    })
    expect(closeClient).toHaveBeenCalledOnce()
    expect(closeResources).toHaveBeenCalledOnce()
  })
})
