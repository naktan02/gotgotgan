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
  it('forwards a revision-checked public Collection copy without browser authority fields', async () => {
    const observed: unknown[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url, init) => {
        expect(url.pathname).toBe('/v1/library/publication-copy-commands')
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-access-token')
        observed.push(JSON.parse(String(init.body)))
        return Response.json({
          schemaVersion: 'published-collection-copy-command-result.v2',
          outcome: 'accepted',
          receipt: { commandId, status: 'applied' },
          collectionId,
          collectionRevision: 'collection-revision.v1.opaque',
          copiedPlaceCount: 1,
        }, { status: 201 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.publicationCopyCommand(new Request(
      'https://place.example/api/library/publication-copy-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'published-collection-copy-command.v2',
          commandId,
          sourcePublicationId: placeId,
          expectedPublicationVersion: 'collection-revision.v1.source',
          target: { collectionId, name: '도쿄 실내 코스' },
          selection: { kind: 'places', placeIds: [tagA] },
        }),
      },
    ))

    expect(response.status).toBe(201)
    expect(observed).toHaveLength(1)
    expect(JSON.stringify(observed[0])).not.toMatch(/memberId|ownerMembershipId/)
  })

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

  it('forwards a strict viewport map query without list pagination', async () => {
    const observed: string[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url) => {
        observed.push(url.toString())
        return Response.json({
          schemaVersion: 'library-map-projection.v1',
          scope: {
            kind: 'state', state: 'saved', tagIds: [tagA], tagMatch: 'all',
            areaKeys: [], taxonomyKeys: [],
          },
          viewport: {
            bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
          },
          features: [{
            kind: 'place', placeId, label: '멘야 하루',
            location: { latitude: 37.5447, longitude: 127.0557 },
          }],
          coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.map(new Request(
      `https://place.example/api/library/map?scope=state&tagIds=${tagA}&west=126.9&south=37.5&east=127.1&north=37.6&zoom=12`,
    ))

    expect(response.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/library/map?scope=state&west=126.9&south=37.5&east=127.1&north=37.6&zoom=12&state=saved&tagMatch=all&tagIds=${tagA}`,
    ])
    expect(await response.json()).toMatchObject({
      schemaVersion: 'library-map-projection.v1', coverage: { representedPlaceCount: 1 },
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
    expect((await http.map(new Request(
      'https://place.example/api/library/map?scope=state&west=127.1&south=37.5&east=126.9&north=37.6&zoom=12',
    ))).status).toBe(400)
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

  it('forwards the flat browser workspace query as a Collection-first request', async () => {
    const observed: string[] = []
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (url) => {
        observed.push(url.toString())
        return Response.json({
          schemaVersion: 'personal-library-workspace.v2',
          filter: {
            favoriteScope: { kind: 'collection', collectionId },
            ratingFilter: { kind: 'rated' },
            tagIds: [tagA], tagMatch: 'all', areaKeys: [areaKey],
            taxonomyKeys: ['food.noodle.ramen'],
          },
          collections: [], places: [],
          availableFilters: {
            coverage: { favoritePlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true },
            areas: [], taxonomies: [],
          },
        })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.workspace(new Request(
      `https://place.example/api/library/workspace?collectionId=${collectionId}&rating=rated&tagIds=${tagA}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen&limit=20`,
    ))

    expect(response.status).toBe(200)
    expect(observed).toEqual([
      `https://place-backend.example/v1/library/workspace?rating=rated&tagMatch=all&limit=20&collectionId=${collectionId}&tagIds=${tagA}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen`,
    ])
    expect(JSON.stringify(await response.json())).not.toMatch(/saved|wanted/i)
  })

  it.each([
    { status: 404, code: 'not-found' },
    { status: 409, code: 'version-conflict' },
    { status: 422, code: 'invalid-selection' },
  ])('preserves a typed filing rejection at HTTP $status', async ({ status, code }) => {
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        schemaVersion: 'place-filing-command-result.v2',
        outcome: 'rejected',
        commandId,
        rejection: { code },
      }, { status })),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.filingCommand(new Request(
      'https://place.example/api/library/filing-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'place-filing-command.v2',
          commandId,
          placeId,
          changes: [{
            collectionId,
            expectedCollectionRevision: 'opaque-revision',
            desired: 'included',
          }],
        }),
      },
    ))

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({
      outcome: 'rejected', rejection: { code },
    })
  })

  it('preserves revision-checked Collection lifecycle conflicts', async () => {
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async (_url, init) => {
        expect(JSON.parse(String(init.body))).toMatchObject({
          schemaVersion: 'collection-lifecycle-command.v2',
          kind: 'update',
          expectedCollectionRevision: 'opaque-revision',
        })
        return Response.json({
          schemaVersion: 'collection-lifecycle-command-result.v2',
          outcome: 'rejected',
          commandId,
          rejection: { code: 'version-conflict' },
        }, { status: 409 })
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.collectionCommand(new Request(
      'https://place.example/api/library/collection-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'collection-lifecycle-command.v2',
          kind: 'update',
          commandId,
          collectionId,
          expectedCollectionRevision: 'opaque-revision',
          name: '도쿄 여행',
        }),
      },
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      outcome: 'rejected', rejection: { code: 'version-conflict' },
    })
  })

  it('preserves an applied Collection lifecycle result with HTTP 201', async () => {
    const http = createBrowserLibraryHttp({
      resolveAuthRuntime: sessionRuntime,
      backend: backend(async () => Response.json({
        schemaVersion: 'collection-lifecycle-command-result.v2',
        outcome: 'accepted',
        receipt: { commandId, status: 'applied' },
        collection: {
          collectionId,
          name: '서울 라멘',
          description: null,
          visibility: 'private',
          publicationId: null,
          placeCount: 0,
          collectionRevision: 'opaque-revision',
          updatedAt: '2026-09-03T00:00:00.000Z',
        },
      }, { status: 201 })),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.collectionCommand(new Request(
      'https://place.example/api/library/collection-commands',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'collection-lifecycle-command.v2',
          kind: 'create',
          commandId,
          collectionId,
          name: '서울 라멘',
          description: null,
        }),
      },
    ))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      outcome: 'accepted', receipt: { status: 'applied' },
    })
  })
})
