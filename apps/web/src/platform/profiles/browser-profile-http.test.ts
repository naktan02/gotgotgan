import { describe, expect, it, vi } from 'vitest'

import { createBrowserProfileHttp } from './browser-profile-http'
import { createProfileBackendClient } from './profile-backend-client'

const at = '2026-08-29T10:00:00.000Z'

function backend(fetcher: (url: URL, init: RequestInit) => Promise<Response>) {
  return createProfileBackendClient({
    environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
    fetcher,
  })
}

function sessionRuntime() {
  return {
    bff: {
      resolveSession: async () => ({
        id: 'session-id',
        tokens: { accessToken: 'server-access-token', expiresAt: at },
        expiresAt: at,
      }),
    },
  }
}

describe('browser Public Profile HTTP', () => {
  it('keeps bearer evidence server-side for settings', async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
      return Response.json({ schemaVersion: 'public-profile-command-result.v1', status: 'applied' }, { status: 201 })
    })
    const http = createBrowserProfileHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(fetcher),
      createCorrelationRef: () => 'profile-ref',
    })
    const response = await http.set(new Request('https://place.example/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        commandId: '01992d20-0000-7000-8000-000000000001',
        profile: {
          handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public', expectedUpdatedAt: null,
        },
      }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(201)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('reads an allowlisted public projection without bearer and marks it noindex', async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).has('authorization')).toBe(false)
      return Response.json({
        schemaVersion: 'public-profile.v1',
        handle: 'ramen-log',
        displayName: '라멘 기록',
        collections: [{
          publicationId: '01992d20-0000-7000-8000-000000000002',
          name: '성수 라멘', description: null, placeCount: 3, updatedAt: at,
        }],
      })
    })
    const http = createBrowserProfileHttp({
      resolveAuthRuntime: () => undefined,
      backend: backend(fetcher),
      createCorrelationRef: () => 'profile-ref',
    })
    const response = await http.published(
      'ramen-log',
      new Request('https://place.example/api/public/profiles/ramen-log?limit=20'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await response.json()).toMatchObject({ handle: 'ramen-log' })
  })

  it('rejects invalid handles before calling the Backend', async () => {
    const fetcher = vi.fn()
    const http = createBrowserProfileHttp({
      resolveAuthRuntime: () => undefined,
      backend: backend(fetcher),
      createCorrelationRef: () => 'profile-ref',
    })
    const response = await http.published(
      'INVALID',
      new Request('https://place.example/api/public/profiles/INVALID'),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
