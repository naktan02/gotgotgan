import { describe, expect, it } from 'vitest'

import { sweepExpiredImportCaptures } from '../index.js'

describe('expired import capture sweep', () => {
  it('deletes a bounded batch and marks deleted or already-missing artifacts', async () => {
    const marked: string[] = []
    const result = await sweepExpiredImportCaptures({
      expiredAt: '2026-08-28T00:00:00.000Z',
      limit: 2,
      retention: {
        findExpired: async ({ limit }) => {
          expect(limit).toBe(2)
          return [
            {
              captureId: 'capture-1', batchId: 'batch-1', providerKey: 'naver',
              artifactReference: 'capture:01992d20-b000-7000-8000-000000000001',
            },
            {
              captureId: 'capture-2', batchId: 'batch-2', providerKey: 'naver',
              artifactReference: 'capture:01992d20-b000-7000-8000-000000000002',
            },
          ]
        },
        markDeleted: async ({ captureId }) => {
          marked.push(captureId)
          return 'marked'
        },
      },
      artifacts: {
        put: async () => ({ reference: '', checksum: '' }),
        get: async () => undefined,
        delete: async ({ reference }) => reference.endsWith('1') ? 'deleted' : 'missing',
      },
    })

    expect(result).toEqual({ examined: 2, deleted: 1, missing: 1, failed: 0 })
    expect(marked).toEqual(['capture-1', 'capture-2'])
  })

  it('reports deletion failures and leaves their metadata retryable', async () => {
    const marked: string[] = []
    const result = await sweepExpiredImportCaptures({
      expiredAt: '2026-08-28T00:00:00.000Z', limit: 10,
      retention: {
        findExpired: async () => [{
          captureId: 'capture-1', batchId: 'batch-1', providerKey: 'google',
          artifactReference: 'capture:01992d20-b000-7000-8000-000000000001',
        }],
        markDeleted: async ({ captureId }) => { marked.push(captureId); return 'marked' },
      },
      artifacts: {
        put: async () => ({ reference: '', checksum: '' }), get: async () => undefined,
        delete: async () => { throw new Error('storage unavailable') },
      },
    })

    expect(result).toEqual({ examined: 1, deleted: 0, missing: 0, failed: 1 })
    expect(marked).toEqual([])
  })

  it('rejects unbounded or invalid sweep input before reading storage', async () => {
    let called = false
    const input = {
      expiredAt: 'not-a-date', limit: 1001,
      retention: {
        findExpired: async () => { called = true; return [] },
        markDeleted: async () => 'marked' as const,
      },
      artifacts: {
        put: async () => ({ reference: '', checksum: '' }), get: async () => undefined,
        delete: async () => 'missing' as const,
      },
    }

    await expect(sweepExpiredImportCaptures(input)).rejects.toThrow('Capture sweep input is invalid')
    expect(called).toBe(false)
  })
})
