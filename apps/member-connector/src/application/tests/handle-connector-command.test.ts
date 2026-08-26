import type {
  ConnectorExtensionEvent,
  ConnectorGrant,
} from '@place/contracts/connector'
import { describe, expect, it, vi } from 'vitest'

import { ConnectorCommandHandler } from '../handle-connector-command.js'

const operationId = '01992d20-7000-7000-8000-000000000041'
const requestId = '01992d20-7000-7000-8000-000000000042'
const installationId = '01992d20-7000-7000-8000-000000000043'

const grant: ConnectorGrant = {
  schemaVersion: 'place-connector-grant.v1',
  operationId,
  providerKey: 'naver',
  operation: 'import-saved-library',
  idempotencyKey: '01992d20-7000-7000-8000-000000000044',
  token: 'opaque.connector.grant.token.that.is.long.enough',
  placeOrigin: 'https://place.example',
  expiresAt: '2026-08-26T12:00:00.000Z',
  limits: {
    maximumItems: 100,
    maximumBytes: 10_000,
    maximumBatches: 10,
    maximumBatchBytes: 5_000,
  },
}

describe('ConnectorCommandHandler', () => {
  it('reports a Whale installation and only actually registered providers', async () => {
    const events: ConnectorExtensionEvent[] = []
    const handler = new ConnectorCommandHandler({
      browserKey: 'whale',
      getInstallationId: async () => installationId,
      operations: new Map(),
    })
    await handler.handle({
      command: {
        schemaVersion: 'place-connector-command.v1',
        channel: 'place-connector',
        requestId,
        kind: 'probe',
      },
      emit: (event) => { events.push(event) },
    })
    expect(events).toEqual([expect.objectContaining({
      kind: 'ready',
      browserKey: 'whale',
      installationId,
      supportedProviders: [],
    })])
  })

  it('rejects a command relayed from an origin other than the grant origin', async () => {
    const operation = vi.fn()
    const events: ConnectorExtensionEvent[] = []
    const handler = new ConnectorCommandHandler({
      browserKey: 'chrome',
      getInstallationId: async () => installationId,
      operations: new Map([['naver', operation]]),
    })
    await handler.handle({
      sourceOrigin: 'https://unexpected.example',
      command: {
        schemaVersion: 'place-connector-command.v1',
        channel: 'place-connector',
        requestId,
        kind: 'start-import',
        grant,
      },
      emit: (event) => { events.push(event) },
    })
    expect(operation).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ kind: 'result', code: 'invalid-request' })
  })

  it('emits progress and a safe completion result through the same request', async () => {
    const events: ConnectorExtensionEvent[] = []
    const handler = new ConnectorCommandHandler({
      browserKey: 'firefox',
      getInstallationId: async () => installationId,
      operations: new Map([['naver', async ({ onProgress }) => {
        await onProgress({
          phase: 'finalizing',
          discoveredItems: 2,
          capturedItems: 2,
          submittedItems: 2,
          submittedBatches: 1,
        })
        return { importBatchId: installationId, itemCount: 2, batchCount: 1, byteCount: 20 }
      }]]),
    })
    await handler.handle({
      sourceOrigin: grant.placeOrigin,
      command: {
        schemaVersion: 'place-connector-command.v1',
        channel: 'place-connector',
        requestId,
        kind: 'start-import',
        grant,
      },
      emit: (event) => { events.push(event) },
    })
    expect(events.map((event) => event.kind)).toEqual(['progress', 'result'])
    expect(events.at(-1)).toMatchObject({ code: 'completed', retryable: false })
  })
})
