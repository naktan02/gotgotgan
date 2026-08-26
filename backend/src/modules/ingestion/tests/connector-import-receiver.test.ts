import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createConnectorImportReceiver } from '../application/receive-connector-import.js'

const ids = {
  operation: '01992d30-0000-7000-8000-000000000001',
  connection: '01992d30-0000-7000-8000-000000000002',
  batch: '01992d30-0000-7000-8000-000000000003',
  installation: '01992d30-0000-7000-8000-000000000004',
  idempotency: '01992d30-0000-7000-8000-000000000005',
  artifact: '01992d30-0000-7000-8000-000000000006',
}
const now = () => new Date('2026-08-26T10:00:00.000Z')
const limits = {
  maximumItems: 1_000,
  maximumBytes: 1_000_000,
  maximumBatches: 100,
  maximumBatchBytes: 100_000,
}

function grantRequest() {
  return {
    schemaVersion: 'place-connector-grant-request.v1' as const,
    installationId: ids.installation,
    browserKey: 'whale' as const,
    providerKey: 'naver' as const,
    operation: 'import-saved-library' as const,
    idempotencyKey: ids.idempotency,
  }
}

describe('connector import receiver', () => {
  it('issues an origin-bound short-lived token while persisting only its digest', async () => {
    const issueGrant = vi.fn(async () => ({
      status: 'created' as const,
      operationId: ids.operation,
      importBatchId: ids.batch,
    }))
    const generated = [ids.operation, ids.connection, ids.batch]
    const receiver = createConnectorImportReceiver({
      store: { issueGrant, beginCapture: vi.fn(), commitCapture: vi.fn() },
      artifacts: { put: vi.fn() },
      parsers: [{
        providerKey: 'naver', parserVersion: 'naver.v1', acquisitionKind: 'browser-network',
        parse: () => ({ kind: 'rejected' }),
      }],
      config: {
        publicOrigin: 'https://place.example', grantTtlMilliseconds: 300_000,
        captureRetentionMilliseconds: 86_400_000, limits,
      },
      nextId: () => generated.shift()!,
      nextToken: () => 'connector-token-that-is-never-persisted-raw',
      now,
    })

    const result = await receiver.issueGrant({
      memberId: '01992d30-0000-7000-8000-000000000010',
      publicOrigin: 'https://place.example',
      request: grantRequest(),
    })

    expect(result.status).toBe('created')
    if (result.status !== 'created') throw new Error('grant was not created')
    expect(result.grant).toMatchObject({
      operationId: ids.operation,
      token: 'connector-token-that-is-never-persisted-raw',
      placeOrigin: 'https://place.example',
      expiresAt: '2026-08-26T10:05:00.000Z',
    })
    expect(issueGrant).toHaveBeenCalledWith(expect.objectContaining({
      tokenDigest: createHash('sha256')
        .update('connector-token-that-is-never-persisted-raw').digest('hex'),
    }))
    expect(JSON.stringify(issueGrant.mock.calls)).not.toContain('never-persisted-raw')
  })

  it('reserves, encrypts, normalizes, and commits one capture in that order', async () => {
    const payload = JSON.stringify({ fixture: true })
    const checksum = createHash('sha256').update(payload).digest('hex')
    const calls: string[] = []
    const receipt = {
      schemaVersion: 'place-connector-capture-receipt.v1' as const,
      operationId: ids.operation,
      acceptedSequence: 0,
      acceptedChecksum: checksum,
      receivedItems: 1,
      receivedBytes: new TextEncoder().encode(payload).byteLength,
      importBatchId: ids.batch,
    }
    const generated = [
      ids.artifact,
      ...Array.from({ length: 10 }, (_, index) =>
        `01992d30-0000-7000-8000-${String(index + 20).padStart(12, '0')}`),
    ]
    const receiver = createConnectorImportReceiver({
      store: {
        issueGrant: vi.fn(),
        beginCapture: vi.fn(async () => {
          calls.push('reserve')
          return {
            status: 'pending' as const, artifactId: ids.artifact,
            importBatchId: ids.batch, retentionUntil: '2026-08-27T10:00:00.000Z',
          }
        }),
        commitCapture: vi.fn(async (command) => {
          calls.push('commit')
          expect(command.items[0]).toMatchObject({
            sourceListId: 'list-1', providerPlaceId: 'provider-place-1',
            fulfillment: expect.any(Object),
          })
          return { status: 'committed' as const, receipt }
        }),
      },
      artifacts: { put: vi.fn(async () => {
        calls.push('artifact')
        return { reference: `capture:${ids.artifact}`, checksum }
      }) },
      parsers: [{
        providerKey: 'naver', parserVersion: 'naver.v1', acquisitionKind: 'browser-network',
        parse: () => ({
          kind: 'page', nextCursor: null,
          items: [{
            sourceItemKey: 'list-1:item-1', sourceListId: 'list-1', sourceItemId: 'item-1',
            sourceListPosition: 0, sourcePosition: 0, providerPlaceId: 'provider-place-1',
            listName: '후쿠오카', name: '라멘', address: '주소', categoryLabel: '음식점',
            location: { latitude: 33.59, longitude: 130.4 }, reviewReasons: [],
          }],
        }),
      }],
      config: {
        publicOrigin: 'https://place.example', grantTtlMilliseconds: 300_000,
        captureRetentionMilliseconds: 86_400_000, limits,
      },
      nextId: () => generated.shift()!,
      nextToken: () => 'unused-token-that-is-long-enough-value',
      now,
    })

    const result = await receiver.submitCapture({
      token: 'connector-token-that-is-long-enough', publicOrigin: 'https://place.example',
      batch: {
        schemaVersion: 'place-connector-capture-batch.v1', operationId: ids.operation,
        providerKey: 'naver', sequence: 0, final: true, itemCount: 1,
        contentType: 'application/json', payload, checksum,
      },
    })

    expect(result).toEqual({ status: 'accepted', receipt })
    expect(calls).toEqual(['reserve', 'artifact', 'commit'])
  })

  it('returns a committed receipt without rewriting an artifact', async () => {
    const payload = '{}'
    const checksum = createHash('sha256').update(payload).digest('hex')
    const receipt = {
      schemaVersion: 'place-connector-capture-receipt.v1' as const,
      operationId: ids.operation, acceptedSequence: 0, acceptedChecksum: checksum,
      receivedItems: 0, receivedBytes: 2, importBatchId: ids.batch,
    }
    const put = vi.fn()
    const receiver = createConnectorImportReceiver({
      store: {
        issueGrant: vi.fn(),
        beginCapture: vi.fn(async () => ({ status: 'replayed' as const, receipt })),
        commitCapture: vi.fn(),
      },
      artifacts: { put },
      parsers: [{
        providerKey: 'naver', parserVersion: 'naver.v1', acquisitionKind: 'browser-network',
        parse: () => ({ kind: 'page', nextCursor: null, items: [] }),
      }],
      config: {
        publicOrigin: 'https://place.example', grantTtlMilliseconds: 300_000,
        captureRetentionMilliseconds: 86_400_000, limits,
      },
      nextId: () => ids.artifact,
      nextToken: () => 'unused-token-that-is-long-enough-value',
      now,
    })

    await expect(receiver.submitCapture({
      token: 'connector-token-that-is-long-enough', publicOrigin: 'https://place.example',
      batch: {
        schemaVersion: 'place-connector-capture-batch.v1', operationId: ids.operation,
        providerKey: 'naver', sequence: 0, final: true, itemCount: 0,
        contentType: 'application/json', payload, checksum,
      },
    })).resolves.toEqual({ status: 'replayed', receipt })
    expect(put).not.toHaveBeenCalled()
  })
})
