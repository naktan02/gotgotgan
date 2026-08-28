import { describe, expect, it, vi } from 'vitest'

import { createBrowserVisitHttp } from './browser-visit-http'
import { createVisitBackendClient } from './visit-backend-client'

const placeId = '01992d20-0000-7000-8000-000000000001'
const visitId = '01992d20-0000-7000-8000-000000000002'
const visitedAt = '2026-08-28T01:30:00.000Z'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createVisitBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
    fetcher: responder,
  })
}

function sessionRuntime() {
  return {
    bff: {
      resolveSession: async () => ({
        id: 'session-id',
        tokens: { accessToken: 'server-access-token', expiresAt: '2026-08-29T00:00:00.000Z' },
        expiresAt: '2026-08-29T00:00:00.000Z',
      }),
    },
  }
}

describe('browser Visit HTTP', () => {
  it('rejects invalid input before resolving authentication', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const http = createBrowserVisitHttp({
      resolveAuthRuntime,
      backend: backend(async () => Response.json({})),
      createCorrelationRef: () => 'correlation-ref',
    })

    expect((await http.history(
      new Request('https://place.example/api/places/not-a-place/visits?limit=20'),
      'not-a-place',
    )).status).toBe(400)
    expect((await http.history(
      new Request(`https://place.example/api/places/${placeId}/visits?limit=20&limit=30`),
      placeId,
    )).status).toBe(400)
    expect((await http.record(new Request('https://place.example/api/visits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: visitId, placeId, visitedAt, evidence: { source: 'browser' } }),
    }))).status).toBe(400)
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
  })

  it('requires a server-side session before calling the backend', async () => {
    const fetcher = vi.fn()
    const http = createBrowserVisitHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.history(
      new Request(`https://place.example/api/places/${placeId}/visits?limit=20`),
      placeId,
    )

    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('forwards and validates one bounded current-member history page', async () => {
    const observed: string[] = []
    const http = createBrowserVisitHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        observed.push(url.toString())
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        return Response.json({
          schemaVersion: 'visit-history.v1',
          placeId,
          items: [{ visitId, visitedAt, recordedAt: visitedAt }],
          nextCursor: 'next-page',
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.history(new Request(
      `https://place.example/api/places/${placeId}/visits?cursor=page-1&limit=20`,
    ), placeId)

    expect(response.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/places/${placeId}/visits?limit=20&cursor=page-1`,
    ])
    expect(await response.json()).toEqual({
      schemaVersion: 'visit-history.v1',
      placeId,
      items: [{ visitId, visitedAt, recordedAt: visitedAt }],
      nextCursor: 'next-page',
    })
  })

  it('forwards a strict immutable Visit record and preserves 201', async () => {
    const http = createBrowserVisitHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v1/visits')
        expect(JSON.parse(String(init.body))).toEqual({ id: visitId, placeId, visitedAt })
        return Response.json({
          schemaVersion: 'visit-record-result.v1', status: 'recorded',
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.record(new Request('https://place.example/api/visits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: visitId, placeId, visitedAt }),
    }))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      schemaVersion: 'visit-record-result.v1', status: 'recorded',
    })
  })
})
