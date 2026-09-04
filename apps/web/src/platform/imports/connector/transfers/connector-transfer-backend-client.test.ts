import { describe, expect, it, vi } from 'vitest'

import { createConnectorTransferBackendClient } from './connector-transfer-backend-client'

const operationId = '01992d20-7000-7000-8000-000000000101'
const manifestId = '01992d20-7000-7000-8000-000000000102'

describe('connector transfer backend client', () => {
  it('uses only reviewed paths, configured origins, and allowlisted headers', async () => {
    const request = vi.fn(async (_input: URL, _init: RequestInit) =>
      Response.json({ ok: true }))
    const client = createConnectorTransferBackendClient({
      origin: 'http://backend.internal:4010',
      publicOrigin: 'https://place.example',
      timeoutMilliseconds: 5_000,
      request,
    })
    const signal = new AbortController().signal
    await client.issueOutboundGrant('server-access-token', {
      schemaVersion: 'outbound-execution-grant-request.v2',
      commandId: '01992d20-7000-7000-8000-000000000106',
      transferId: '01992d20-7000-7000-8000-000000000107',
      expectedTransferRevision: 'r1',
      installationId: '01992d20-7000-7000-8000-000000000108',
      accountFingerprint: 'c'.repeat(64),
      placeOrigin: 'https://place.example',
    }, signal)

    expect(request).toHaveBeenCalledOnce()
    const [url, init] = request.mock.calls[0]!
    expect(url.toString()).toBe(
      'http://backend.internal:4010/v2/transfers/outbound-execution-grants',
    )
    expect(init).toMatchObject({
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
    })
    const headers = new Headers(init.headers)
    expect(Object.fromEntries(headers)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer server-access-token',
      'content-type': 'application/json',
      origin: 'https://place.example',
    })
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('x-forwarded-host')).toBe(false)
  })

  it('forwards a member grant only with a server bearer and fixed body route', async () => {
    const request = vi.fn(async (_input: URL, _init: RequestInit) =>
      Response.json({ ok: true }))
    const client = createConnectorTransferBackendClient({
      origin: 'https://backend.example', publicOrigin: 'https://place.example',
      timeoutMilliseconds: 5_000, request,
    })
    const body = {
      schemaVersion: 'connector-import-grant-request.v2' as const,
      commandId: '01992d20-7000-7000-8000-000000000103', operationId,
      connectionId: '01992d20-7000-7000-8000-000000000104', expectedConnectionRevision: 'r1',
      providerKey: 'naver' as const, accountFingerprint: 'a'.repeat(64),
      installationId: '01992d20-7000-7000-8000-000000000105',
      placeOrigin: 'https://place.example',
      manifest: {
        manifestId, manifestDigest: 'b'.repeat(64), sourceRevision: 'source-r1',
        observedAt: '2026-09-04T00:00:00.000Z', capturedAt: '2026-09-04T00:00:01.000Z',
        chunkCount: 1, listCount: 0, itemCount: 0, byteCount: 2,
      },
    }
    await client.issueImportGrant('server-access-token', body, new AbortController().signal)

    const [url, init] = request.mock.calls[0]!
    expect(url.pathname).toBe('/v2/transfers/connector-import-grants')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
    expect(init.body).toBe(JSON.stringify(body))
  })

  it.each([
    ['not-an-origin', 'https://place.example'],
    ['ftp://backend.example', 'https://place.example'],
    ['https://backend.example/private', 'https://place.example'],
    ['https://backend.example', 'http://place.example'],
    ['https://backend.example', 'https://user:secret@place.example'],
  ])('fails closed for invalid backend/public origin %s / %s', (origin, publicOrigin) => {
    expect(() => createConnectorTransferBackendClient({
      origin, publicOrigin, timeoutMilliseconds: 5_000,
    })).toThrow('Connector transfer backend configuration is invalid')
  })
})
