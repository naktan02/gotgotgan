import { describe, expect, it } from 'vitest'

import { createCatalogHomeClient } from './catalog-home-client'

describe('Catalog Home browser client', () => {
  it('uses the canonical-only catalog contract and route', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init })
      return Response.json({
        schemaVersion: 'catalog-place-search.v1',
        interpretation: {
          normalizedQuery: '성수 카페',
          tokens: [{
            tokenId: 'query:성수 카페', kind: 'query', label: '성수 카페', normalizedQuery: '성수 카페',
          }],
        },
        items: [{
          placeId: '550e8400-e29b-41d4-a716-446655440000',
          name: '카탈로그 장소',
          area: null,
          location: { latitude: 37.5, longitude: 127 },
          primaryTaxonomy: null,
          taxonomyReferences: [],
          evidenceStatus: 'verified',
          projectedAt: '2026-09-03T00:00:00+00:00',
        }],
        mapBounds: null,
      })
    }

    await expect(createCatalogHomeClient(fetcher).search({
      query: '성수 카페',
      cursor: 'next-page',
    }))
      .resolves.toMatchObject({ schemaVersion: 'catalog-place-search.v1' })
    expect(calls[0]?.input).toBe('/api/search/catalog')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      schemaVersion: 'catalog-place-search.v1', query: '성수 카페', excludedTokenIds: [], cursor: 'next-page',
    })
  })

  it('uses the bounded map projection route instead of list items as marker data', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init })
      return Response.json({
        schemaVersion: 'catalog-place-map.v1',
        interpretation: { normalizedQuery: '서울 카페', tokens: [] },
        viewport: { west: 126, south: 37, east: 128, north: 38 },
        zoom: 11,
        mode: 'places',
        features: [{
          kind: 'place', featureId: 'place:550e8400-e29b-41d4-a716-446655440000',
          placeId: '550e8400-e29b-41d4-a716-446655440000', name: '카탈로그 카페',
          location: { latitude: 37.5, longitude: 127 }, areaLabel: '서울',
          primaryTaxonomy: { key: 'cafe', label: '카페' }, placeCount: 1,
        }],
        coverage: { matchingPlaceCount: 1, representedPlaceCount: 1, complete: true },
      })
    }

    await expect(createCatalogHomeClient(fetcher).map({
      query: '서울 카페',
      viewport: { west: 126, south: 37, east: 128, north: 38 },
      zoom: 11,
    })).resolves.toMatchObject({ mode: 'places' })
    expect(calls[0]?.input).toBe('/api/search/catalog/map')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      schemaVersion: 'catalog-place-map.v1', maxFeatures: 384,
    })
  })

  it('forwards an antimeridian viewport to the search-this-area list request without failing closed', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const crossingBounds = { west: 170, south: -20, east: -170, north: 20 }
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init })
      return Response.json({
        schemaVersion: 'catalog-place-search.v1',
        interpretation: { normalizedQuery: '태평양 여행', tokens: [] },
        items: [],
        mapBounds: crossingBounds,
      })
    }

    await expect(createCatalogHomeClient(fetcher).search({
      query: '태평양 여행',
      bounds: crossingBounds,
    })).resolves.toMatchObject({ mapBounds: crossingBounds })
    expect(calls[0]?.input).toBe('/api/search/catalog')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ bounds: crossingBounds })
  })
})
