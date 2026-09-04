import { describe, expect, it, vi } from 'vitest'

import { createBrowserOperationHttp } from './browser-operation-http'
import { createOperationBackendClient } from './operation-backend-client'
import { operationJsonByteLimits } from './operation-json-envelope'

const operationId = '01992d20-0000-7000-8000-000000000201'
const commandId = '01992d20-0000-7000-8000-000000000202'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createOperationBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' }, fetcher: responder,
  })
}

function sessionRuntime() {
  return { bff: { resolveSession: async () => ({
    id: 'session-id', tokens: { accessToken: 'server-access-token', expiresAt: '2026-09-03T00:00:00.000Z' },
    expiresAt: '2026-09-03T00:00:00.000Z',
  }) } }
}

describe('browser operation HTTP', () => {
  it('validates list filters and forwards server-side bearer authority', async () => {
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v2/operations')
        expect(url.searchParams.get('kind')).toBe('outbound-transfer')
        expect(url.searchParams.get('state')).toBe('outcome-unknown')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        return Response.json({ schemaVersion: 'transfer-operation-list.v2', items: [] })
      }),
      createCorrelationRef: () => 'unused',
    })
    const response = await http.list(new Request('https://place.example/api/v2/operations?kind=outbound-transfer&state=outcome-unknown&limit=20'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [] })
  })

  it('rejects unknown query input before contacting the backend', async () => {
    const fetcher = vi.fn()
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime, backend: backend(fetcher), createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.items(new Request(`https://place.example/api/v2/operations/${operationId}/items?debug=true`), operationId)
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not expose operation history without a browser session', async () => {
    const fetcher = vi.fn()
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher), createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.summary(new Request('https://place.example/api/v2/operations/summary'))
    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards a revision-guarded command and preserves a typed conflict', async () => {
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v2/operation-commands')
        expect(JSON.parse(String(init.body))).toMatchObject({
          operationId, expectedOperationRevision: 'operation-r1', action: 'reconcile',
        })
        return Response.json({
          schemaVersion: 'transfer-operation-command-result.v2', outcome: 'rejected', commandId,
          rejection: { code: 'revision-conflict' },
        }, { status: 409 })
      }),
      createCorrelationRef: () => 'unused',
    })
    const response = await http.command(new Request('https://place.example/api/v2/operation-commands', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        schemaVersion: 'transfer-operation-command.v2', commandId, operationId,
        expectedOperationRevision: 'operation-r1', action: 'reconcile',
      }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: 'rejected', rejection: { code: 'revision-conflict' } })
  })

  it('rejects an oversized command before contacting the Backend', async () => {
    const fetcher = vi.fn()
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(fetcher),
      createCorrelationRef: () => 'local-correlation-ref',
    })
    const response = await http.command(new Request(
      'https://place.example/api/v2/operation-commands',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(operationJsonByteLimits.commandRequest + 1),
        },
        body: '{}',
      },
    ))

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_OPERATION_REQUEST_TOO_LARGE',
      correlationRef: 'local-correlation-ref',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds every Backend operation projection before contract parsing', async () => {
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(operationJsonByteLimits.itemsResponse + 1),
        },
      })),
      createCorrelationRef: () => 'safe-correlation-ref',
    })
    const command = new Request('https://place.example/api/v2/operation-commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 'transfer-operation-command.v2', commandId, operationId,
        expectedOperationRevision: 'operation-r1', action: 'reconcile',
      }),
    })

    const responses = await Promise.all([
      http.list(new Request('https://place.example/api/v2/operations')),
      http.summary(new Request('https://place.example/api/v2/operations/summary')),
      http.detail(new Request(`https://place.example/api/v2/operations/${operationId}`), operationId),
      http.items(new Request(`https://place.example/api/v2/operations/${operationId}/items`), operationId),
      http.command(command),
    ])

    expect(responses.map((response) => response.status)).toEqual([503, 503, 503, 503, 503])
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        code: 'PLACE_OPERATION_WEB_UNAVAILABLE', correlationRef: 'safe-correlation-ref',
      })
    }
  })

  it.each([401, 403])('preserves a bounded Backend %i Problem', async (status) => {
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        type: 'urn:place:error:access-denied', title: 'Access denied', status,
        code: 'PLACE_ACCESS_DENIED', retryable: false,
        correlationRef: 'backend-correlation-ref',
      }, { status, headers: { 'content-type': 'application/problem+json' } })),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.detail(
      new Request(`https://place.example/api/v2/operations/${operationId}`), operationId,
    )

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({
      status, code: 'PLACE_ACCESS_DENIED', correlationRef: 'backend-correlation-ref',
    })
  })

  it('redacts a Problem whose declared status does not match the Backend status', async () => {
    const http = createBrowserOperationHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        type: 'urn:place:error:access-denied', title: 'private backend detail', status: 403,
        code: 'PLACE_ACCESS_DENIED', retryable: false,
        correlationRef: 'private-backend-correlation',
      }, { status: 401, headers: { 'content-type': 'application/problem+json' } })),
      createCorrelationRef: () => 'safe-correlation-ref',
    })

    const response = await http.summary(
      new Request('https://place.example/api/v2/operations/summary'),
    )
    const responseBody = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(responseBody).not.toContain('private backend detail')
    expect(responseBody).not.toContain('private-backend-correlation')
  })
})
