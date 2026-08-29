import { describe, expect, it, vi } from 'vitest'

import { createBrowserLibraryHttp } from './browser-library-http'
import { createLibraryBackendClient } from './library-backend-client'

const placeId = '01992d20-0000-7000-8000-000000000001'
const tagA = '01992d20-0000-7000-8000-000000000002'
const tagB = '01992d20-0000-7000-8000-000000000003'
const commandId = '01992d20-0000-7000-8000-000000000004'
const collectionId = '01992d20-0000-7000-8000-000000000005'
const areaKey = 'area_abcdefghijklmnopqrstuv'

function backend(responder: (url: URL, init: RequestInit) => Promise<Response>) {
  return createLibraryBackendClient({
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

describe('browser library HTTP', () => {
  it('requires a server-side session before calling the backend', async () => {
    const fetcher = vi.fn()
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: async () => undefined } }),
      backend: backend(fetcher),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.places(new Request('https://place.example/api/library/places'))

    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('validates repeated tag filters and returns only the contract projection', async () => {
    const observed: string[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        observed.push(url.toString())
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        return Response.json({
          schemaVersion: 'library-place-list.v3',
          filter: {
            state: 'wanted', tagIds: [tagA, tagB], tagMatch: 'all',
            areaKeys: [areaKey], taxonomyKeys: ['food.noodle.ramen'],
          },
          items: [{
            placeId,
            saved: true,
            wanted: true,
            personalRating: null,
            updatedAt: '2026-08-28T00:00:00.000Z',
            place: null,
          }],
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.places(new Request(
      `https://place.example/api/library/places?state=wanted&tagIds=${tagB}&tagIds=${tagA}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen&limit=20`,
    ))

    expect(response.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/library/places?limit=20&state=wanted&tagMatch=all&tagIds=${tagA}&tagIds=${tagB}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen`,
    ])
    expect(await response.json()).toMatchObject({
      schemaVersion: 'library-place-list.v3',
      filter: {
        state: 'wanted', tagIds: [tagA, tagB], tagMatch: 'all',
        areaKeys: [areaKey], taxonomyKeys: ['food.noodle.ramen'],
      },
    })
  })

  it('forwards the member-scoped facet projection without query parameters', async () => {
    const observed: string[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url) => {
        observed.push(url.toString())
        return Response.json({
          schemaVersion: 'library-place-facets.v1', sourceState: 'saved',
          coverage: { savedPlaceCount: 2, sampledPlaceCount: 2, projectedPlaceCount: 2, complete: true },
          areas: [{ key: areaKey, label: '서울 성동구', count: 2 }],
          taxonomies: [],
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    expect((await http.facets(new Request('https://place.example/api/library/place-facets'))).status).toBe(200)
    expect(observed).toEqual(['https://place-backend.example/v1/library/place-facets'])
    expect((await http.facets(new Request('https://place.example/api/library/place-facets?memberId=private'))).status).toBe(400)
  })

  it('rejects unknown, duplicate, and invalid query values before authentication', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime,
      backend: backend(async () => Response.json({})),
      createCorrelationRef: () => 'correlation-ref',
    })

    for (const query of ['memberId=private', 'limit=20&limit=30', 'tagIds=not-a-uuid']) {
      const response = await http.places(new Request(`https://place.example/api/library/places?${query}`))
      expect(response.status).toBe(400)
    }
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
  })

  it('validates and forwards a bounded selected Place organization query', async () => {
    const observed: string[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url) => {
        observed.push(url.toString())
        return Response.json({
          schemaVersion: 'library-place-organization.v1',
          placeId,
          items: [{ kind: 'tag', tagId: tagA, name: '쇼유라멘', selected: true }],
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.organization(new Request(
      `https://place.example/api/library/places/${placeId}/organization?cursor=page-2&limit=50`,
    ), placeId)

    expect(response.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/library/places/${placeId}/organization?limit=50&cursor=page-2`,
    ])
  })

  it('forwards a strict command and preserves applied status', async () => {
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (_url, init) => {
        expect(JSON.parse(String(init.body))).toEqual({
          commandId,
          command: {
            kind: 'set-place-preferences',
            placeId,
            expectedUpdatedAt: '2026-08-28T00:00:00.000Z',
            saved: true,
            wanted: false,
            personalRating: 4.5,
          },
        })
        return Response.json({
          schemaVersion: 'library-command-result.v1', status: 'applied',
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.command(new Request('https://place.example/api/library/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: {
          kind: 'set-place-preferences', placeId,
          expectedUpdatedAt: '2026-08-28T00:00:00.000Z',
          saved: true, wanted: false, personalRating: 4.5,
        },
      }),
    }))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      schemaVersion: 'library-command-result.v1', status: 'applied',
    })
  })

  it('server-fixes new Collections as private and rejects browser-selected visibility', async () => {
    const observed: unknown[] = []
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime,
      backend: backend(async (_url, init) => {
        observed.push(JSON.parse(String(init.body)))
        return Response.json({
          schemaVersion: 'library-command-result.v1', status: 'applied',
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const created = await http.command(new Request('https://place.example/api/library/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: { kind: 'create-collection', collectionId, name: '성수 라멘' },
      }),
    }))
    expect(created.status).toBe(201)
    expect(observed).toEqual([{
      commandId,
      command: { kind: 'create-collection', collectionId, name: '성수 라멘' },
    }])

    resolveAuthRuntime.mockClear()
    const rejected = await http.command(new Request('https://place.example/api/library/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commandId,
        command: {
          kind: 'create-collection', collectionId, name: '공격자 공개 목록',
          visibility: 'public', publicationId: placeId,
        },
      }),
    }))
    expect(rejected.status).toBe(400)
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
  })

  it('rejects an invalid Place identifier before authentication', async () => {
    const resolveAuthRuntime = vi.fn(sessionRuntime)
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime,
      backend: backend(async () => Response.json({})),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.place(
      new Request('https://place.example/api/places/not-a-place'),
      'not-a-place',
    )

    expect(response.status).toBe(400)
    expect(resolveAuthRuntime).not.toHaveBeenCalled()
  })
})
