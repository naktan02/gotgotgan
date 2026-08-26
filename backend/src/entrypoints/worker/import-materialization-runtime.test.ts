import { describe, expect, it, vi } from 'vitest'

import type {
  ImportedPlaceFulfillmentClaim,
  ImportedPlaceFulfillmentStore,
} from '../../modules/ingestion/index.js'
import {
  runImportMaterialization,
  type ImportMaterializationConfig,
} from './import-materialization-runtime.js'

const config: ImportMaterializationConfig = {
  database: {
    connectionString: 'postgresql://place:secret@database/place',
    maxConnections: 2,
    idleTimeoutMilliseconds: 10_000,
    connectionTimeoutMilliseconds: 3_000,
  },
  leaseMilliseconds: 60_000,
  idleMilliseconds: 100,
  maximumJobs: 10,
}

const claim: ImportedPlaceFulfillmentClaim = {
  jobId: '01992d40-0000-7000-8000-000000000001',
  providerKey: 'naver',
  providerPlaceId: 'naver-place-1',
  attemptCount: 1,
  observationId: '01992d40-0000-7000-8000-000000000002',
  candidateId: '01992d40-0000-7000-8000-000000000003',
  decisionId: '01992d40-0000-7000-8000-000000000004',
  proposedPlaceId: '01992d40-0000-7000-8000-000000000005',
  lease: { owner: 'worker', generation: 1, expiresAt: '2026-08-27T00:01:00.000Z' },
  items: [{
    itemId: '01992d40-0000-7000-8000-000000000006',
    batchId: '01992d40-0000-7000-8000-000000000007',
    memberId: '01992d40-0000-7000-8000-000000000008',
    connectionId: '01992d40-0000-7000-8000-000000000009',
    providerKey: 'naver', providerPlaceId: 'naver-place-1',
    sourceListId: 'list-1', sourceItemId: 'item-1',
    sourceListPosition: 0, sourcePosition: 0,
    listName: '여행', name: '장소', address: null, categoryLabel: null, location: null,
    observationId: '01992d40-0000-7000-8000-000000000010',
    candidateId: '01992d40-0000-7000-8000-000000000011',
    decisionId: '01992d40-0000-7000-8000-000000000012',
    proposedPlaceId: '01992d40-0000-7000-8000-000000000013',
    capture: {
      reference: 'capture:fixture', checksum: 'a'.repeat(64),
      parserVersion: 'naver-saved-place.v1', acquisitionKind: 'browser-network',
      observedAt: '2026-08-27T00:00:00.000Z',
    },
  }],
}

describe('import materialization runtime', () => {
  it('drains queued source snapshots and always closes resources', async () => {
    const close = vi.fn(async () => undefined)
    const store: ImportedPlaceFulfillmentStore = {
      claimNextFulfillment: vi.fn()
        .mockResolvedValueOnce(claim)
        .mockResolvedValueOnce(undefined),
      renewFulfillmentLease: vi.fn(async () => true),
      completeFulfillmentItem: vi.fn(async () => undefined),
      finishFulfillmentJob: vi.fn(async () => undefined),
    }

    await expect(runImportMaterialization(config, { continuous: false }, {
      workerId: 'worker',
      now: () => new Date('2026-08-27T00:00:00.000Z'),
      createResources: async () => ({
        store,
        ingestionStore: { append: vi.fn(async () => 'recorded' as const) },
        canonical: {
          resolveProviderIdentity: vi.fn(async () => ({
            status: 'linked' as const,
            placeId: '01992d40-0000-7000-8000-000000000099',
          })),
          apply: vi.fn(async () => ({ status: 'applied' as const })),
        },
        library: { saveImportedPlace: vi.fn(async () => ({ status: 'applied' as const })) },
        close,
      }),
    })).resolves.toEqual({ processed: 1, stopped: 'idle' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes without claiming after a continuous runtime is aborted', async () => {
    const close = vi.fn(async () => undefined)
    const controller = new AbortController()
    controller.abort()

    await expect(runImportMaterialization(config, {
      continuous: true,
      signal: controller.signal,
    }, {
      createResources: async () => ({
        store: {} as ImportedPlaceFulfillmentStore,
        ingestionStore: { append: vi.fn() },
        canonical: {} as never,
        library: {} as never,
        close,
      }),
    })).resolves.toEqual({ processed: 0, stopped: 'aborted' })
    expect(close).toHaveBeenCalledOnce()
  })
})
