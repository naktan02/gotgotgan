import { describe, expect, it, vi } from 'vitest'

import type {
  WebImportAcquisitionStore,
  WebImportArtifactStore,
} from '../../modules/transfers/index.js'
import {
  runWebImportAcquisitions,
  type WebImportAcquisitionConfig,
} from './web-import-acquisition-runtime.js'

const config: WebImportAcquisitionConfig = {
  database: {
    connectionString: 'postgresql://place:secret@database/place',
    maxConnections: 2,
    idleTimeoutMilliseconds: 10_000,
    connectionTimeoutMilliseconds: 3_000,
  },
  artifacts: {
    root: 'C:\\place-captures', activeKeyId: 'test',
    keys: { test: new Uint8Array(32) }, maximumBytes: 1_000_000,
  },
  workerId: 'web-import-worker-test',
  leaseMilliseconds: 600_000,
  idleMilliseconds: 100,
  maximumJobs: 10,
}

describe('web import acquisition runtime', () => {
  it('closes its dedicated resources after a bounded idle pass', async () => {
    const close = vi.fn(async () => undefined)
    const store = {
      pendingArtifactCleanup: vi.fn(async () => []),
      claim: vi.fn(async () => undefined),
    } as unknown as WebImportAcquisitionStore
    const artifacts = {
      discard: vi.fn(),
    } as unknown as WebImportArtifactStore

    await expect(runWebImportAcquisitions(config, { continuous: false }, {
      now: () => new Date('2026-09-05T03:00:00.000Z'),
      createResources: async () => ({
        store,
        artifacts,
        source: { providerKey: 'naver', inspect: vi.fn() },
        close,
      }),
    })).resolves.toEqual({ processed: 0, stopped: 'idle' })
    expect(close).toHaveBeenCalledOnce()
  })
})
