import { describe, expect, it, vi } from 'vitest'

import { createBrowserConnectorTransferHttp } from './browser-connector-transfer-http'
import type { ConnectorTransferBackendClient } from './connector-transfer-backend-client'

const publicOrigin = 'https://place.example'
const commandId = '01992d20-7000-7000-8000-000000000111'
const operationId = '01992d20-7000-7000-8000-000000000112'
const connectionId = '01992d20-7000-7000-8000-000000000113'
const installationId = '01992d20-7000-7000-8000-000000000114'
const manifestId = '01992d20-7000-7000-8000-000000000115'

function importGrantRequest(placeOrigin = publicOrigin) {
  return {
    schemaVersion: 'connector-import-grant-request.v2' as const,
    commandId, operationId, connectionId, expectedConnectionRevision: 'connection-r1',
    providerKey: 'naver' as const, accountFingerprint: 'a'.repeat(64), installationId,
    placeOrigin,
    manifest: {
      manifestId, manifestDigest: 'b'.repeat(64), sourceRevision: 'source-r1',
      observedAt: '2026-09-04T00:00:00.000Z', capturedAt: '2026-09-04T00:00:01.000Z',
      chunkCount: 1, listCount: 0, itemCount: 0, byteCount: 2,
    },
  }
}

function browserRequest(body: unknown, input: Readonly<{
  origin?: string
  headers?: Readonly<Record<string, string>>
}> = {}): Request {
  return new Request(`${publicOrigin}/api/v2/transfers/connector-import-grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin: input.origin ?? publicOrigin,
      ...input.headers,
    },
    body: JSON.stringify(body),
  })
}

function backend(overrides: Partial<ConnectorTransferBackendClient> = {}) {
  const unused = vi.fn(async () => { throw new Error('unexpected backend call') })
  return {
    publicOrigin,
    issueImportGrant: unused,
    issueOutboundGrant: unused,
    ...overrides,
  } as ConnectorTransferBackendClient
}

function sessionRuntime(hasSession = true) {
  return { bff: { resolveSession: vi.fn(async () => hasSession ? ({
    id: 'opaque-session',
    tokens: { accessToken: 'server-access-token', expiresAt: '2026-09-04T01:00:00.000Z' },
    expiresAt: '2026-09-04T01:00:00.000Z',
  }) : undefined) } }
}

function http(input: Readonly<{
  backend?: ConnectorTransferBackendClient
  auth?: ReturnType<typeof sessionRuntime>
}> = {}) {
  return createBrowserConnectorTransferHttp({
    resolveAuthRuntime: () => input.auth ?? sessionRuntime(),
    resolveBackend: () => input.backend ?? backend(),
    createCorrelationRef: () => 'local-correlation-ref',
  })
}

describe('browser connector transfer HTTP', () => {
  it('exposes only the two authenticated grant operations', () => {
    expect(Object.keys(http())).toEqual(['issueImportGrant', 'issueOutboundGrant'])
  })

  it('requires a server-side member session before invoking the Backend', async () => {
    const issueImportGrant = vi.fn()
    const response = await http({
      auth: sessionRuntime(false), backend: backend({ issueImportGrant }),
    }).issueImportGrant(browserRequest(importGrantRequest()))

    expect(response.status).toBe(401)
    expect(issueImportGrant).not.toHaveBeenCalled()
  })

  it('binds the member grant to the configured public Origin and server bearer', async () => {
    const issueImportGrant = vi.fn(async () => Response.json({
      schemaVersion: 'connector-import-grant-result.v2', outcome: 'rejected', commandId,
      rejection: { code: 'connection-not-ready' },
    }, { status: 409 }))
    const request = browserRequest(importGrantRequest())
    const response = await http({ backend: backend({ issueImportGrant }) })
      .issueImportGrant(request)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: 'rejected', commandId })
    expect(issueImportGrant).toHaveBeenCalledWith(
      'server-access-token', importGrantRequest(), request.signal,
    )
  })

  it.each([
    [browserRequest(importGrantRequest(), { origin: 'https://unexpected.example' })],
    [browserRequest(importGrantRequest('https://unexpected.example'))],
  ])('rejects any request or grant origin outside the configured public Origin', async (request) => {
    const issueImportGrant = vi.fn()
    const response = await http({ backend: backend({ issueImportGrant }) })
      .issueImportGrant(request)
    expect(response.status).toBe(403)
    expect(issueImportGrant).not.toHaveBeenCalled()
  })

  it('rejects declared oversized bodies before parsing or invoking the Backend', async () => {
    const issueImportGrant = vi.fn()
    const request = browserRequest({}, { headers: { 'content-length': '524289' } })
    const response = await http({ backend: backend({ issueImportGrant }) })
      .issueImportGrant(request)
    expect(response.status).toBe(413)
    expect(issueImportGrant).not.toHaveBeenCalled()
  })

  it('passes through only bounded contract Problems', async () => {
    const issueImportGrant = vi.fn(async () => Response.json({
      type: 'urn:place:error:access-denied', title: 'Access denied', status: 403,
      code: 'PLACE_ACCESS_DENIED', retryable: false, correlationRef: 'backend-correlation',
    }, { status: 403, headers: { 'content-type': 'application/problem+json' } }))
    const response = await http({ backend: backend({ issueImportGrant }) })
      .issueImportGrant(browserRequest(importGrantRequest()))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_ACCESS_DENIED', correlationRef: 'backend-correlation',
    })
  })

  it('replaces malformed Backend failures without leaking details or addresses', async () => {
    const issueImportGrant = vi.fn(async () => Response.json({
      error: 'backend-secret at http://private-backend.internal:4010',
    }, { status: 500 }))
    const response = await http({ backend: backend({ issueImportGrant }) })
      .issueImportGrant(browserRequest(importGrantRequest()))
    const body = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(body).not.toContain('backend-secret')
    expect(body).not.toContain('private-backend.internal')
  })
})
