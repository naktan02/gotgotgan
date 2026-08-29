import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PublishedCollectionHttpProblem,
  publishedCollectionHttp,
} from './published-collection-http'

const publicationId = '01992d20-0000-7000-8000-000000000001'

afterEach(() => vi.restoreAllMocks())

describe('published Collection same-origin HTTP', () => {
  it('loads the next list cursor independently from the map viewport', async () => {
    const request = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 'place-published-collection.v3', publicationId,
        visibility: 'public', name: '공개 목록', description: null, placeCount: 51,
        places: [], updatedAt: '2026-08-29T00:00:00.000Z',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 'place-published-collection-map.v1', publicationId,
        viewport: {
          bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
        },
        features: [],
        coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await publishedCollectionHttp.page(publicationId, 'page-2')
    await publishedCollectionHttp.map(publicationId, {
      west: 126.9, south: 37.5, east: 127.1, north: 37.6, zoom: 12,
    })

    const listUrl = new URL(request.mock.calls[0]?.[0].toString() ?? '', 'http://place.test')
    const mapUrl = new URL(request.mock.calls[1]?.[0].toString() ?? '', 'http://place.test')
    expect(listUrl.searchParams.get('cursor')).toBe('page-2')
    expect(mapUrl.pathname).toContain('/map')
    expect(mapUrl.searchParams.has('cursor')).toBe(false)
  })

  it('rejects a successful but non-allowlisted response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'place-published-collection.v3', publicationId,
      visibility: 'public', name: '공개 목록', description: null, placeCount: 0,
      places: [], updatedAt: '2026-08-29T00:00:00.000Z', memberId: 'private',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(publishedCollectionHttp.page(publicationId))
      .rejects.toBeInstanceOf(PublishedCollectionHttpProblem)
  })
})
