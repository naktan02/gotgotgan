import { describe, expect, it, vi } from 'vitest'

import { createCollectionLibraryHttp } from './collection-library-http'

const collectionId = '01992d20-3000-7000-8000-000000000011'
const commandId = '01992d20-3000-7000-8000-000000000021'

describe('Collection-first Library browser client', () => {
  it('serializes one Collection scope without legacy Place states', async () => {
    let requested = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested = String(input)
      return Response.json({
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'collection', collectionId },
        ratingFilter: { kind: 'any' },
        tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      },
      collections: [],
      places: [],
      availableFilters: {
        coverage: { favoritePlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true },
        areas: [], taxonomies: [],
      },
      })
    })
    const client = createCollectionLibraryHttp(fetcher as typeof fetch)

    await client.workspace({
      favoriteScope: { kind: 'collection', collectionId },
      ratingFilter: { kind: 'any' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
      collectionQuery: '라멘 목록', placeQuery: '성수동 쇼유라멘',
      includeSelectedCollection: true,
    })

    const url = new URL(requested, 'https://gotgotgan.test')
    expect(url.pathname).toBe('/api/library/workspace')
    expect(url.searchParams.get('collectionId')).toBe(collectionId)
    expect(url.searchParams.get('rating')).toBe('any')
    expect(url.searchParams.get('collectionQuery')).toBe('라멘 목록')
    expect(url.searchParams.get('placeQuery')).toBe('성수동 쇼유라멘')
    expect(url.searchParams.get('includeSelectedCollection')).toBe('true')
    expect(url.searchParams.has('state')).toBe(false)
  })

  it('uses identical place filters in the Collection-first v2 map boundary', async () => {
    let requested = ''
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requested = String(input)
      return Response.json({
        schemaVersion: 'personal-library-map.v2',
        filter: { favoriteScope: { kind: 'collection', collectionId }, ratingFilter: { kind: 'rated' },
          tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: ['ramen.shoyu'], placeQuery: '성수동 라멘' },
        viewport: { bounds: { west: 126, south: 37, east: 128, north: 38 }, zoom: 12 },
        features: [], coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
      })
    })
    await createCollectionLibraryHttp(fetcher as typeof fetch).map({
      favoriteScope: { kind: 'collection', collectionId }, ratingFilter: { kind: 'rated' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: ['ramen.shoyu'], placeQuery: '성수동 라멘',
      west: 126, south: 37, east: 128, north: 38, zoom: 12,
    })
    const url = new URL(requested, 'https://gotgotgan.test')
    expect(url.pathname).toBe('/api/library/workspace/map')
    expect(url.searchParams.get('scope')).toBeNull()
    expect(url.searchParams.get('collectionId')).toBe(collectionId)
    expect(url.searchParams.get('rating')).toBe('rated')
    expect(url.searchParams.getAll('taxonomyKeys')).toEqual(['ramen.shoyu'])
    expect(url.searchParams.get('placeQuery')).toBe('성수동 라멘')
  })

  it('uses revision-checked v2 commands for Collection lifecycle changes', async () => {
    let body: unknown
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        schemaVersion: 'collection-lifecycle-command-result.v2',
        outcome: 'accepted',
        receipt: { commandId, status: 'applied' },
        collection: null,
      }, { status: 201 })
    })
    const client = createCollectionLibraryHttp(fetcher as typeof fetch)

    await client.collectionCommand({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'delete',
      commandId,
      collectionId,
      expectedCollectionRevision: 'opaque-revision',
    })

    expect(body).toEqual({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'delete',
      commandId,
      collectionId,
      expectedCollectionRevision: 'opaque-revision',
    })
  })
})
