import type {
  ConnectorCaptureBatch,
  ConnectorCaptureReceipt,
  ConnectorGrant,
} from '@place/contracts/connector'
import { describe, expect, it, vi } from 'vitest'

import { collectSavedLibrary } from '../collect-saved-library.js'
import type { CaptureSubmission } from '../ports/capture-submission.js'
import type { ProviderSession } from '../ports/provider-session.js'
import type { SavedPlaceSource } from '../ports/saved-place-source.js'

const operationId = '01992d20-7000-7000-8000-000000000021'
const importBatchId = '01992d20-7000-7000-8000-000000000022'

function grant(limits: Partial<ConnectorGrant['limits']> = {}): ConnectorGrant {
  return {
    schemaVersion: 'place-connector-grant.v1',
    operationId,
    providerKey: 'naver',
    operation: 'import-saved-library',
    idempotencyKey: '01992d20-7000-7000-8000-000000000023',
    token: 'opaque.connector.grant.token.that.is.long.enough',
    placeOrigin: 'https://place.example',
    expiresAt: '2026-08-26T12:00:00.000Z',
    limits: {
      maximumItems: 100,
      maximumBytes: 10_000,
      maximumBatches: 10,
      maximumBatchBytes: 5_000,
      ...limits,
    },
  }
}

const activeSession: ProviderSession = {
  providerKey: 'naver',
  probe: async () => 'active',
}

function source(payloads: readonly string[]): SavedPlaceSource {
  return {
    providerKey: 'naver',
    async *collect() {
      for (const payload of payloads) {
        yield { acquisitionKind: 'browser-network' as const, itemCount: 1, payload }
      }
    },
  }
}

function submission(batches: ConnectorCaptureBatch[]): CaptureSubmission {
  return {
    submit: async ({ batch }): Promise<ConnectorCaptureReceipt> => {
      batches.push(batch)
      return {
        schemaVersion: 'place-connector-capture-receipt.v1',
        operationId,
        acceptedSequence: batch.sequence,
        acceptedChecksum: batch.checksum,
        receivedItems: batches.reduce((total, item) => total + item.itemCount, 0),
        receivedBytes: batches.reduce(
          (total, item) => total + new TextEncoder().encode(item.payload).byteLength,
          0,
        ),
        importBatchId,
      }
    },
  }
}

describe('collectSavedLibrary', () => {
  it('hides pagination behind one operation and submits ordered final batches', async () => {
    const batches: ConnectorCaptureBatch[] = []
    const progress = vi.fn()
    const result = await collectSavedLibrary({
      session: activeSession,
      source: source(['{"items":[1]}', '{"items":[2]}']),
      submission: submission(batches),
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    }, {
      grant: grant(),
      signal: new AbortController().signal,
      onProgress: progress,
    })

    expect(batches.map(({ sequence, final }) => ({ sequence, final }))).toEqual([
      { sequence: 0, final: false },
      { sequence: 1, final: true },
    ])
    expect(batches[0]?.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(result).toEqual({
      importBatchId,
      itemCount: 2,
      batchCount: 2,
      byteCount: 26,
    })
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'finalizing',
      submittedItems: 2,
      submittedBatches: 2,
    }))
  })

  it('stops before collection when the provider session requires user action', async () => {
    const collect = vi.fn()
    const session: ProviderSession = {
      providerKey: 'naver',
      probe: async () => 'reauth-required',
    }
    await expect(collectSavedLibrary({
      session,
      source: { providerKey: 'naver', collect },
      submission: submission([]),
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    }, {
      grant: grant(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'reauth-required',
      retryable: false,
    })
    expect(collect).not.toHaveBeenCalled()
  })

  it('rejects a provider source that omits its provider-specific empty capture', async () => {
    await expect(collectSavedLibrary({
      session: activeSession,
      source: source([]),
      submission: submission([]),
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    }, {
      grant: grant(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'provider-drift', retryable: false })
  })

  it('rejects a batch before upload when the operation grant limit is exceeded', async () => {
    const submit = vi.fn(async ({ batch }: { batch: ConnectorCaptureBatch }) => ({
      schemaVersion: 'place-connector-capture-receipt.v1' as const,
      operationId,
      acceptedSequence: batch.sequence,
      acceptedChecksum: batch.checksum,
      receivedItems: batch.itemCount,
      receivedBytes: new TextEncoder().encode(batch.payload).byteLength,
      importBatchId,
    }))
    await expect(collectSavedLibrary({
      session: activeSession,
      source: source(['{"items":[1]}', '{"items":[2]}']),
      submission: { submit },
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    }, {
      grant: grant({ maximumItems: 1 }),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'upload-rejected',
      retryable: false,
    })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('rejects a receipt that acknowledges a different payload checksum', async () => {
    await expect(collectSavedLibrary({
      session: activeSession,
      source: source(['{"items":[1]}']),
      submission: {
        submit: async ({ batch }) => ({
          schemaVersion: 'place-connector-capture-receipt.v1',
          operationId,
          acceptedSequence: batch.sequence,
          acceptedChecksum: '0'.repeat(64),
          receivedItems: batch.itemCount,
          receivedBytes: new TextEncoder().encode(batch.payload).byteLength,
          importBatchId,
        }),
      },
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    }, {
      grant: grant(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'upload-rejected',
      retryable: false,
    })
  })
})
