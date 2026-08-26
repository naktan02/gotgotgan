import { describe, expect, it, vi } from 'vitest'

import type { CaptureArtifactReplayStore } from '../../modules/ingestion/index.js'
import type { ImportCaptureRetentionStore } from '../../modules/ingestion/index.js'
import { runCaptureExpirySweep, type CaptureSweepConfig } from './capture-sweep-runtime.js'

const config: CaptureSweepConfig = {
  database: {
    connectionString: 'postgresql://place:secret@database/place',
    maxConnections: 2,
    idleTimeoutMilliseconds: 10_000,
    connectionTimeoutMilliseconds: 3_000,
  },
  artifacts: {
    root: 'C:\\captures',
    activeKeyId: 'primary',
    keys: { primary: new Uint8Array(32) },
    maximumBytes: 10_485_760,
  },
  limit: 100,
}

describe('capture expiry sweep runtime', () => {
  it('runs a bounded sweep and always closes its owned resources', async () => {
    const close = vi.fn(async () => undefined)
    const retention: ImportCaptureRetentionStore = {
      findExpired: vi.fn(async () => []),
      markDeleted: vi.fn(async () => 'marked' as const),
    }
    const artifacts = {} as CaptureArtifactReplayStore
    const createResources = vi.fn(async () => ({ retention, artifacts, close }))

    await expect(runCaptureExpirySweep(config, {
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      createResources,
    })).resolves.toEqual({ examined: 0, deleted: 0, missing: 0, failed: 0 })
    expect(retention.findExpired).toHaveBeenCalledWith({
      expiredAt: '2026-08-26T00:00:00.000Z',
      limit: 100,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes resources when the sweep fails', async () => {
    const close = vi.fn(async () => undefined)
    const failure = new Error('database unavailable')
    const retention: ImportCaptureRetentionStore = {
      findExpired: vi.fn(async () => { throw failure }),
      markDeleted: vi.fn(async () => 'marked' as const),
    }

    await expect(runCaptureExpirySweep(config, {
      createResources: async () => ({
        retention,
        artifacts: {} as CaptureArtifactReplayStore,
        close,
      }),
    })).rejects.toBe(failure)
    expect(close).toHaveBeenCalledOnce()
  })
})
