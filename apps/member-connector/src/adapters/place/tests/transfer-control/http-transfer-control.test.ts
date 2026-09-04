import type {
  ConnectorImportGrantRequestV2,
  ConnectorImportGrantV2,
  OutboundExecutionConsumeRequestV2,
} from '@place/contracts/transfers'
import { describe, expect, it, vi } from 'vitest'

import {
  HttpImmutableSnapshotHandoff,
  HttpOutboundExecutionControl,
  PlaceTransferHttp,
  type PlaceTransferJsonTransport,
} from '../../transfer-control/index.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const connectionId = '22222222-2222-4222-8222-222222222222'
const installationId = '33333333-3333-4333-8333-333333333333'
const manifestId = '44444444-4444-4444-8444-444444444444'
const grantId = '55555555-5555-4555-8555-555555555555'
const transferId = '66666666-6666-4666-8666-666666666666'
const receiptReference = '77777777-7777-4777-8777-777777777777'
const accountFingerprint = 'a'.repeat(64)
const token = 'opaque-connector-grant-token-that-is-long-enough'
const receiptToken = 'opaque-receipt-token-that-must-stay-header-only'
const manifest = {
  manifestId,
  manifestDigest: 'b'.repeat(64),
  sourceRevision: 'snapshot-r1',
  observedAt: '2026-09-04T00:00:00.000Z',
  capturedAt: '2026-09-04T00:00:00.000Z',
  chunkCount: 1,
  listCount: 1,
  itemCount: 1,
  byteCount: 2,
} as const
const grant: ConnectorImportGrantV2 = {
  schemaVersion: 'connector-import-grant.v2', grantId, operationId, connectionId,
  providerKey: 'naver', accountFingerprint, installationId,
  operation: 'import-saved-library', token, placeOrigin: 'https://place.example', manifest,
  issuedAt: '2026-09-04T00:00:00.000Z', expiresAt: '2026-09-04T00:05:00.000Z',
  limits: { maximumChunks: 10, maximumItems: 100, maximumBytes: 10_000,
    maximumChunkBytes: 1_024 },
}
const grantRequest: ConnectorImportGrantRequestV2 = {
  schemaVersion: 'connector-import-grant-request.v2',
  commandId: '88888888-8888-4888-8888-888888888888',
  operationId, connectionId, expectedConnectionRevision: 'connection-r1',
  providerKey: 'naver', accountFingerprint, installationId,
  placeOrigin: 'https://place.example', manifest,
}

type Request = Parameters<PlaceTransferJsonTransport['request']>[0]
function response(body: unknown, status = 200) {
  return { status, contentType: 'application/json', bodyText: JSON.stringify(body) }
}
function clients(transport: PlaceTransferJsonTransport) {
  const limits = { maximumRequestBytes: 5_000_000, maximumResponseBytes: 100_000 }
  return {
    member: new PlaceTransferHttp(
      { kind: 'member-session-bff', origin: 'https://place.example' }, transport, limits,
    ),
    capability: new PlaceTransferHttp({
      kind: 'extension-capability', origin: 'https://connector.example',
      expectedExtensionOrigin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, transport, limits),
  }
}

describe('v2 Connector transfer HTTP adapters', () => {
  it('separates member-session grant BFF from extension-origin capability requests', async () => {
    const requests: Request[] = []
    const transport: PlaceTransferJsonTransport = { request: vi.fn(async (request) => {
      requests.push(request)
      if (request.url.endsWith('/api/v2/transfers/connector-import-grants')) {
        return response({
          schemaVersion: 'connector-import-grant-result.v2', outcome: 'accepted',
          commandId: grantRequest.commandId, status: 'applied', grant,
        })
      }
      return response({
        schemaVersion: 'connector-capture-manifest-status.v2', operationId, manifestId,
        state: 'receiving', recordedSequences: [], nextSequence: 0,
        snapshotId: null, snapshotVersion: null,
      })
    }) }
    const http = clients(transport)
    const handoff = new HttpImmutableSnapshotHandoff(http.member, http.capability)
    const signal = new AbortController().signal
    await expect(handoff.issueGrant({ request: grantRequest, signal })).resolves.toMatchObject({
      outcome: 'accepted', grant: { grantId },
    })
    await expect(handoff.status({ grant, signal })).resolves.toMatchObject({ state: 'receiving' })

    expect(requests[0]).toMatchObject({
      url: 'https://place.example/api/v2/transfers/connector-import-grants',
      credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' },
    })
    expect(requests[1]).toMatchObject({
      url: `https://connector.example/v2/transfers/connector-captures/${operationId}/${manifestId}`,
      credentials: 'omit',
      headers: { accept: 'application/json', authorization: `PlaceConnector ${token}` },
    })
    expect(requests[1]?.body).toBeUndefined()
  })

  it('keeps authorization tokens out of JSON and strictly parses exact receipts', async () => {
    const requests: Request[] = []
    const transport: PlaceTransferJsonTransport = { request: vi.fn(async (request) => {
      requests.push(request)
      return response({
        schemaVersion: 'outbound-execution-authorization-receipt.v2', status: 'consumed',
        grantId, receiptReference, receiptToken,
        operationId, transferId, connectionId, providerKey: 'naver', accountFingerprint,
        installationId, planDigest: 'c'.repeat(64), batchSize: 100,
        authorizedAt: '2026-09-04T00:00:00.000Z', expiresAt: '2026-09-04T00:05:00.000Z',
        reconciliationExpiresAt: '2026-09-04T01:00:00.000Z',
        limits: { maximumItems: 100, maximumBytes: 10_000, maximumBatches: 10 },
      })
    }) }
    const control = new HttpOutboundExecutionControl(clients(transport).capability)
    const request: OutboundExecutionConsumeRequestV2 = {
      schemaVersion: 'outbound-execution-consume-request.v2', grantId, operationId, connectionId,
      providerKey: 'naver', accountFingerprint, installationId, planDigest: 'c'.repeat(64),
      sourceOrigin: 'https://place.example', itemCount: 1, byteCount: 100,
      batchCount: 1, batchSize: 100,
    }
    await expect(control.consume({
      token, request, signal: new AbortController().signal,
    })).resolves.toMatchObject({ receiptReference, receiptToken })

    const sent = requests[0]
    expect(sent?.headers.authorization).toBe(`PlaceConnector ${token}`)
    expect(sent?.body).not.toContain(token)
    expect(sent?.body).not.toContain(receiptToken)
    expect(JSON.stringify(sent)).not.toContain(receiptToken)
  })

  it('fails closed on malformed receipts, server problems, and credential-channel misuse', async () => {
    const invalidControl = new HttpOutboundExecutionControl(clients({
      request: async () => response({ accepted: true }),
    }).capability)
    const request: OutboundExecutionConsumeRequestV2 = {
      schemaVersion: 'outbound-execution-consume-request.v2', grantId, operationId, connectionId,
      providerKey: 'naver', accountFingerprint, installationId, planDigest: 'c'.repeat(64),
      sourceOrigin: 'https://place.example', itemCount: 1, byteCount: 100,
      batchCount: 1, batchSize: 100,
    }
    await expect(invalidControl.consume({
      token, request, signal: new AbortController().signal,
    })).resolves.toEqual({
      status: 'unavailable', retryable: true, code: 'PLACE_CONNECTOR_CONTROL_UNAVAILABLE',
    })

    const unavailable = new HttpOutboundExecutionControl(clients({
      request: async () => response({
        code: 'PLACE_CONNECTOR_CONTROL_UNAVAILABLE', retryable: true,
      }, 503),
    }).capability)
    await expect(unavailable.consume({
      token, request, signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: 'unavailable', retryable: true })

    const http = clients({ request: async () => response({}) })
    await expect(http.member.send({
      pathname: '/v2/transfers/outbound-execution-attempts', method: 'POST',
      token, body: {}, signal: new AbortController().signal,
    })).rejects.toThrow('credential boundary')
    await expect(http.capability.send({
      pathname: '/v2/transfers/outbound-execution-attempts', method: 'POST',
      body: {}, signal: new AbortController().signal,
    })).rejects.toThrow('credential boundary')
  })
})
