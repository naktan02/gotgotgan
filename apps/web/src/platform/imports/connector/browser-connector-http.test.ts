import { describe, expect, it, vi } from 'vitest'

import { createBrowserConnectorHttp } from './browser-connector-http'

const operationId = '01992d20-7000-7000-8000-000000000071'
const installationId = '01992d20-7000-7000-8000-000000000072'
const idempotencyKey = '01992d20-7000-7000-8000-000000000073'
const importBatchId = '01992d20-7000-7000-8000-000000000074'
const token = 'opaque.connector.grant.token.that.is.long.enough'

function grant(placeOrigin = 'https://place.example') {
  return {
    schemaVersion: 'place-connector-grant.v1', operationId, providerKey: 'naver',
    operation: 'import-saved-library', idempotencyKey, token, placeOrigin,
    expiresAt: '2026-08-26T12:00:00.000Z',
    limits: {
      maximumItems: 100, maximumBytes: 10_000,
      maximumBatches: 10, maximumBatchBytes: 5_000,
    },
  }
}

describe('browser connector HTTP', () => {
  it('binds a grant to the authenticated public origin', async () => {
    const publicOrigin = 'http://localhost:3000'
    const issueGrant = vi.fn(async () => Response.json(grant(publicOrigin)))
    const http = createBrowserConnectorHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => ({
        tokens: { accessToken: 'server-access-token' },
      }) } }) as never,
      resolveConnectorBackend: () => ({
        publicOrigin, issueGrant, submitCapture: vi.fn(), ready: vi.fn(),
      }),
      createCorrelationRef: () => 'correlation-fixture',
    })
    const response = await http.issueGrant(new Request('http://web:3000/api/connector/grants', {
      method: 'POST',
      body: JSON.stringify({
        schemaVersion: 'place-connector-grant-request.v1', installationId,
        browserKey: 'whale', providerKey: 'naver', operation: 'import-saved-library',
        idempotencyKey,
      }),
    }))

    expect(response.status).toBe(200)
    expect(issueGrant).toHaveBeenCalledWith('server-access-token', expect.any(Object), publicOrigin)
  })

  it('accepts only matching connector authorization, sequence, and checksum receipts', async () => {
    const checksum = 'a'.repeat(64)
    const submitCapture = vi.fn(async () => Response.json({
      schemaVersion: 'place-connector-capture-receipt.v1', operationId,
      acceptedSequence: 0, acceptedChecksum: checksum,
      receivedItems: 1, receivedBytes: 12, importBatchId,
    }))
    const http = createBrowserConnectorHttp({
      resolveAuthRuntime: () => undefined,
      resolveConnectorBackend: () => ({
        publicOrigin: 'http://localhost:3000',
        issueGrant: vi.fn(), submitCapture, ready: vi.fn(),
      }),
      createCorrelationRef: () => 'correlation-fixture',
    })
    const response = await http.submitCapture(new Request('http://web:3000/api/connector/captures', {
      method: 'POST',
      headers: {
        authorization: `PlaceConnector ${token}`,
        'x-place-connector-operation': operationId,
      },
      body: JSON.stringify({
        schemaVersion: 'place-connector-capture-batch.v1', operationId,
        providerKey: 'naver', sequence: 0, final: true, itemCount: 1,
        contentType: 'application/json', payload: '{"items":[]}', checksum,
      }),
    }))

    expect(response.status).toBe(200)
    expect(submitCapture).toHaveBeenCalledWith(
      `PlaceConnector ${token}`, expect.any(Object), 'http://localhost:3000',
    )
  })
})
