import { describe, expect, it, vi } from 'vitest'

import { createBrowserTransferHttp } from './browser-transfer-http'
import { createTransferBackendClient } from './transfer-backend-client'

const connectionId = '01992d20-0000-7000-8000-000000000001'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createTransferBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
    fetcher: responder,
  })
}

function sessionRuntime() {
  return { bff: { resolveSession: async () => ({
    id: 'session-id',
    tokens: { accessToken: 'server-access-token', expiresAt: '2026-09-03T00:00:00.000Z' },
    expiresAt: '2026-09-03T00:00:00.000Z',
  }) } }
}

describe('browser transfer HTTP', () => {
  it('forwards target-list discovery with server-side bearer authority', async () => {
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe(`/v2/transfers/provider-connections/${connectionId}/target-lists`)
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        return Response.json({
          schemaVersion: 'provider-target-list-projection.v2', connectionId,
          availability: 'available', reason: null, targetObservationRevision: 'target-r1',
          items: [{ targetListId: 'remote-list', name: '도쿄 여행', itemCount: 3 }],
        })
      }),
      createCorrelationRef: () => 'unused',
    })
    const response = await http.targetLists(new Request('https://place.example/api/v2/transfers'), connectionId)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ availability: 'available' })
  })

  it('does not call the backend without a browser session', async () => {
    const fetcher = vi.fn()
    const http = createBrowserTransferHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher),
      createCorrelationRef: () => 'correlation-ref',
    })
    const response = await http.connections(new Request('https://place.example/api/v2/transfers/provider-connections'))
    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
