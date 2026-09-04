import { describe, expect, it, vi } from 'vitest'

import {
  SearchBackendProblem,
  getSearchTaxonomy,
  searchCatalogMap,
  selectPlaceSuggestion,
  searchPlaces,
  suggestPlaces,
} from './search-backend-client'
import type { BackendFetcher } from '../backend-http/fixed-backend'

const request = { schemaVersion: 'place-search.v1' as const, query: '라멘' }
const response = {
  schemaVersion: 'place-search.v1' as const,
  items: [{
    resultId: 'place:01992d20-0000-7000-8000-000000000101',
    identity: {
      kind: 'canonical' as const,
      placeId: '01992d20-0000-7000-8000-000000000101',
    },
    source: {
      key: 'local', label: '내 장소', detailsAvailable: false, attributions: [],
    },
    freshness: { kind: 'indexed' as const, observedAt: '2026-08-26T10:00:00.000Z' },
    name: '조용한 라멘 연구소', areaLabel: '성수',
    location: { latitude: 37.5445, longitude: 127.056 },
    primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
    taxonomyKeys: ['food.noodle.ramen'], evidenceStatus: 'verified' as const,
  }],
  sources: [{ sourceKey: 'local', status: 'complete' as const, resultCount: 1 }],
}

describe('search backend client', () => {
  it('uses the fixed backend path and validates the response contract', async () => {
    const observed: Array<{ input: URL; init: RequestInit }> = []
    const fetcher: BackendFetcher = vi.fn(async (input, init) => {
      observed.push({ input, init })
      return new Response(JSON.stringify(response), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })

    await expect(searchPlaces(request, { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, fetcher)).resolves.toEqual(response)
    expect(observed[0]?.input).toEqual(new URL('http://backend.test:4010/v1/search/places'))
    expect(observed[0]?.init).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store' }))
    expect(JSON.parse(String(observed[0]?.init.body))).not.toHaveProperty('memberId')
  })

  it('uses the dedicated bounded catalog map path', async () => {
    const observed: URL[] = []
    const fetcher: BackendFetcher = vi.fn(async (input) => {
      observed.push(input)
      return Response.json({
        schemaVersion: 'catalog-place-map.v1',
        interpretation: { normalizedQuery: '라멘', tokens: [] },
        viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 5,
        mode: 'clusters',
        features: [{
          kind: 'cluster', featureId: 'grid:5:1:1',
          location: { latitude: 37.5, longitude: 127 },
          bounds: { west: 126, south: 37, east: 128, north: 38 }, placeCount: 3,
        }],
        coverage: { matchingPlaceCount: 3, representedPlaceCount: 3, complete: true },
      })
    })
    await expect(searchCatalogMap({
      schemaVersion: 'catalog-place-map.v1', query: '라멘', excludedTokenIds: [],
      viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 5,
    }, { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, fetcher)).resolves.toMatchObject({
      mode: 'clusters',
    })
    expect(observed[0]?.pathname).toBe('/v1/search/catalog/map')
  })

  it('fails closed on oversized or compressed catalog map responses', async () => {
    const mapRequest = {
      schemaVersion: 'catalog-place-map.v1' as const,
      query: '라멘', excludedTokenIds: [],
      viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 5,
    }
    const oversized: BackendFetcher = vi.fn(async () => new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'content-length': String(1_024 * 1_024 + 1),
      },
    }))
    const compressed: BackendFetcher = vi.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    }))
    await expect(searchCatalogMap(
      mapRequest, { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, oversized,
    )).rejects.toThrow('Search JSON')
    await expect(searchCatalogMap(
      mapRequest, { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, compressed,
    )).rejects.toThrow('Search JSON')
  })

  it('returns only a bounded safe problem from backend failures', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      type: 'urn:place:error:search-unavailable', title: 'Search unavailable',
      status: 503, code: 'PLACE_SEARCH_UNAVAILABLE', retryable: true,
      correlationRef: 'test-ref', internalAddress: 'private-host',
    }), { status: 503, headers: { 'content-type': 'application/problem+json' } }))

    await expect(searchPlaces(request, { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, fetcher)).rejects.toEqual(
      new SearchBackendProblem(503, 'PLACE_SEARCH_UNAVAILABLE', 'Search unavailable', true, 'test-ref'),
    )
  })

  it('validates taxonomy through its own fixed read operation', async () => {
    const taxonomy = { schemaVersion: 'place-taxonomy.v1', nodes: [] }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(taxonomy), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(getSearchTaxonomy({ PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }, fetcher)).resolves.toEqual(taxonomy)
  })

  it('forwards only the provider-neutral suggestion session and validates selection', async () => {
    const suggestionId = '01992d20-5000-7000-8000-000000000001'
    const sessionId = '01992d20-5000-7000-8000-000000000002'
    const observed: Array<{ input: URL; init: RequestInit }> = []
    const fetcher: BackendFetcher = vi.fn(async (input, init) => {
      observed.push({ input, init })
      return observed.length === 1
        ? Response.json({
          schemaVersion: 'place-suggestions.v1', sessionId,
          items: [{
            suggestionId,
            identity: { kind: 'provider', providerKey: 'google', providerPlaceId: 'google-1' },
            source: { key: 'google', label: 'Google Maps', detailsAvailable: true, attributions: [{ label: 'Google Maps' }] },
            name: 'Senkai Ramen', areaLabel: 'Fukuoka, Japan', location: null,
            categoryLabel: 'Ramen restaurant', observedAt: '2026-08-26T10:00:00.000Z',
          }],
          sources: [{ sourceKey: 'google', status: 'complete', resultCount: 1 }],
        })
        : Response.json({
          schemaVersion: 'place-suggestion-selection.v1', suggestionId,
          status: 'recorded', observationId: '01992d20-5000-7000-8000-000000000003',
        })
    })

    const environment = { PLACE_BACKEND_ORIGIN: 'http://backend.test:4010' }
    await expect(suggestPlaces({
      schemaVersion: 'place-suggestions.v1', query: '센카이', sessionId,
    }, environment, fetcher)).resolves.toMatchObject({ sessionId })
    await expect(selectPlaceSuggestion({
      schemaVersion: 'place-suggestion-selection.v1', suggestionId,
    }, environment, fetcher)).resolves.toMatchObject({ suggestionId, status: 'recorded' })
    expect(observed.map((item) => item.input.pathname)).toEqual([
      '/v1/search/suggestions', '/v1/search/suggestion-selections',
    ])
    expect(JSON.stringify(observed)).not.toMatch(/providerSession|apiKey|cookie/i)
  })
})
