import type { ConnectorGrant } from '@place/contracts/connector'
import { describe, expect, it, vi } from 'vitest'

import { ConnectorCommandHandler } from '../../../application/handle-connector-command.js'
import { registerConnectorBackground } from '../webextensions/register-background.js'

const operationId = '01992d20-7000-7000-8000-000000000061'
const requestId = '01992d20-7000-7000-8000-000000000062'
const installationId = '01992d20-7000-7000-8000-000000000063'

const grant: ConnectorGrant = {
  schemaVersion: 'place-connector-grant.v1',
  operationId,
  providerKey: 'naver',
  operation: 'import-saved-library',
  idempotencyKey: '01992d20-7000-7000-8000-000000000064',
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

describe('registerConnectorBackground', () => {
  it('rejects invalid messages before invoking the application handler', () => {
    let listener: ((
      message: unknown,
      sender: { url?: string; tab?: { id?: number; url?: string } },
      sendResponse: (response?: unknown) => void,
    ) => void) | undefined
    const runtime = {
      runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: { sendMessage: vi.fn() },
    }
    registerConnectorBackground(runtime, new ConnectorCommandHandler({
      browserKey: 'whale',
      getInstallationId: async () => installationId,
      operations: new Map(),
    }))
    const respond = vi.fn()
    listener?.({ kind: 'start-import', cookie: 'not-allowed' }, {}, respond)
    expect(respond).toHaveBeenCalledWith({ accepted: false })
    expect(runtime.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('derives the Place origin and sends only validated events to the source tab', async () => {
    let listener: ((
      message: unknown,
      sender: { url?: string; tab?: { id?: number; url?: string } },
      sendResponse: (response?: unknown) => void,
    ) => void) | undefined
    const sendMessage = vi.fn(async () => undefined)
    const runtime = {
      runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value } } },
      tabs: { sendMessage },
    }
    const operation = vi.fn(async () => ({
      importBatchId: installationId,
      itemCount: 0,
      batchCount: 1,
      byteCount: 12,
    }))
    registerConnectorBackground(runtime, new ConnectorCommandHandler({
      browserKey: 'whale',
      getInstallationId: async () => installationId,
      operations: new Map([['naver', operation]]),
    }))
    const respond = vi.fn()
    listener?.({
      schemaVersion: 'place-connector-command.v1',
      channel: 'place-connector',
      requestId,
      kind: 'start-import',
      grant,
    }, {
      url: `${grant.placeOrigin}/imports`,
      tab: { id: 7 },
    }, respond)

    expect(respond).toHaveBeenCalledWith({ accepted: true })
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        kind: 'result',
        operationId,
        code: 'completed',
      }),
    ))
    expect(operation).toHaveBeenCalledOnce()
  })
})
