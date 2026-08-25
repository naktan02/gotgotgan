import { describe, expect, it, vi } from 'vitest'

import {
  SearchBackendProblem,
  getSearchTaxonomy,
  searchPlaces,
} from './search-backend-client'
import type { BackendFetcher } from '../backend-http/fixed-backend'

const request = { schemaVersion: 'place-search.v1' as const, query: '라멘' }
const response = {
  schemaVersion: 'place-search.v1' as const,
  items: [{
    placeId: '01992d20-0000-7000-8000-000000000101',
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
})
