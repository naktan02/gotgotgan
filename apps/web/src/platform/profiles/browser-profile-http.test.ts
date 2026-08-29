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

  it('keeps owner moderation evidence behind the browser session', async () => {
    const appealBodies: unknown[] = []
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
      if (url.pathname.endsWith('/moderation-notices')) {
        expect(url.searchParams.get('limit')).toBe('20')
        return Response.json({
          schemaVersion: 'public-profile-moderation-notices.v1',
          notices: [{
            noticeId: '01992d20-0000-7000-8000-000000000010',
            handle: 'ramen-log', kind: 'withheld', reason: 'privacy', createdAt: at,
            acknowledgedAt: null, appeal: null,
          }],
        })
      }
      if (url.pathname.endsWith('/acknowledgement')) {
        expect(init.method).toBe('PUT')
        return Response.json({
          schemaVersion: 'public-profile-notice-acknowledgement.v1',
          status: 'acknowledged', acknowledgedAt: at,
        }, { status: 201 })
      }
      expect(url.pathname).toBe('/v1/profiles/current/moderation-appeals')
      expect(init.method).toBe('POST')
      appealBodies.push(JSON.parse(String(init.body)))
      return Response.json({
        schemaVersion: 'public-profile-appeal-result.v1', status: 'recorded',
      }, { status: 201 })
    })
    const http = createBrowserProfileHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(fetcher),
      createCorrelationRef: () => 'profile-ref',
    })

    const notices = await http.notices(new Request(
      'https://place.example/api/profile/moderation-notices?limit=20',
    ))
    expect(notices.status).toBe(200)
    expect(JSON.stringify(await notices.json())).not.toMatch(/member|operator|token/i)

    const acknowledgement = await http.acknowledgeNotice(
      '01992d20-0000-7000-8000-000000000010',
      new Request('https://place.example/api/profile/moderation-notices/notice/acknowledgement', {
        method: 'PUT',
      }),
    )
    expect(acknowledgement.status).toBe(201)

    const appeal = await http.appeal(new Request(
      'https://place.example/api/profile/moderation-appeals',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appealId: '01992d20-0000-7000-8000-000000000011',
          noticeId: '01992d20-0000-7000-8000-000000000010',
          reason: 'mistaken-identity',
        }),
      },
    ))
    expect(appeal.status).toBe(201)
    expect(appealBodies).toEqual([{
      appealId: '01992d20-0000-7000-8000-000000000011',
      noticeId: '01992d20-0000-7000-8000-000000000010',
      reason: 'mistaken-identity',
    }])
  })

  it('rejects forged owner fields and invalid notice identifiers before Backend calls', async () => {
    const fetcher = vi.fn()
    const http = createBrowserProfileHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(fetcher),
      createCorrelationRef: () => 'profile-ref',
    })
    const appeal = await http.appeal(new Request(
      'https://place.example/api/profile/moderation-appeals',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appealId: '01992d20-0000-7000-8000-000000000011',
          noticeId: '01992d20-0000-7000-8000-000000000010',
          reason: 'mistaken-identity',
          memberId: '01992d20-0000-7000-8000-000000000099',
        }),
      },
    ))
    expect(appeal.status).toBe(400)
    expect((await http.acknowledgeNotice(
      'not-a-uuid',
      new Request('https://place.example/api/profile/moderation-notices/bad/acknowledgement', {
        method: 'PUT',
      }),
    )).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
