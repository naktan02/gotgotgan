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
})
