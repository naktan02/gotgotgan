import { describe, expect, it, vi } from 'vitest'

import {
  getPublicCollection,
  getPublicCollectionMap,
  getPublicWriting,
  PublicationNotFoundError,
} from './publication-backend-client'

const environment = { PLACE_BACKEND_ORIGIN: 'http://place-backend.example' }

describe('publication backend client', () => {
  it('uses fixed public paths and validates the collection projection', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'place-published-collection.v3',
      publicationId: '01992d20-0000-7000-8000-000000000001',
      visibility: 'unlisted',
      name: 'Shared',
      description: null,
      placeCount: 1,
      places: [{
        placeId: '01992d20-0000-7000-8000-000000000003',
        position: 0,
        place: {
          placeId: '01992d20-0000-7000-8000-000000000003',
          name: '조용한 라멘 연구소',
          areaLabel: '서울 성동구 성수동',
          location: { latitude: 37.5445, longitude: 127.056 },
          primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
          taxonomyKeys: ['food.noodle.ramen'],
          evidence: { status: 'verified', projectedAt: '2026-08-26T10:00:00.000Z' },
        },
      }],
      updatedAt: '2026-08-26T10:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getPublicCollection(
      '01992d20-0000-7000-8000-000000000001',
      { limit: 50 },
      environment,
    )).resolves.toMatchObject({ name: 'Shared' })
    expect(request.mock.calls[0]?.[0].toString()).toBe('http://place-backend.example/v1/public/collections/01992d20-0000-7000-8000-000000000001?limit=50')
    request.mockRestore()
  })

  it('requests an independent viewport map without a list cursor', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'place-published-collection-map.v1',
      publicationId: '01992d20-0000-7000-8000-000000000001',
      viewport: {
        bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
      },
      features: [],
      coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await getPublicCollectionMap(
      '01992d20-0000-7000-8000-000000000001',
      { west: 126.9, south: 37.5, east: 127.1, north: 37.6, zoom: 12 },
      environment,
    )
    const url = new URL(request.mock.calls[0]?.[0].toString() ?? '')
    expect(url.pathname).toBe('/v1/public/collections/01992d20-0000-7000-8000-000000000001/map')
    expect(url.searchParams.has('cursor')).toBe(false)
    request.mockRestore()
  })

  it('rejects private fields even when the backend responds successfully', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      kind: 'note', publicationId: 'p', visibility: 'public', body: 'safe', placeIds: ['x'],
      updatedAt: '2026-08-26T10:00:00.000Z', memberId: 'private',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(getPublicWriting('p', environment)).rejects.toThrow('invalid writing')
    request.mockRestore()
  })

  it('maps absence without reflecting backend payload details', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('private row exists', { status: 404 }))
    await expect(getPublicCollection('private', { limit: 50 }, environment))
      .rejects.toBeInstanceOf(PublicationNotFoundError)
    request.mockRestore()
  })
})
