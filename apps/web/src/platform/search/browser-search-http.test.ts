import { describe, expect, it, vi } from 'vitest'

import { createBrowserSearchHttp } from './browser-search-http'
import { SearchBackendProblem } from './search-backend-client'

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://place.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function dependencies() {
  return {
    backend: {
      catalog: vi.fn(async () => ({
        schemaVersion: 'catalog-place-search.v1',
        interpretation: { normalizedQuery: '', tokens: [] },
        items: [], mapBounds: null,
      })),
      catalogMap: vi.fn(async () => ({
        schemaVersion: 'catalog-place-map.v1', interpretation: { normalizedQuery: '', tokens: [] },
        viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 11,
        mode: 'places', features: [],
        coverage: { matchingPlaceCount: 0, representedPlaceCount: 0, complete: true },
      })),
      places: vi.fn(async () => ({ schemaVersion: 'place-search.v1', items: [], sources: [] })),
      suggestions: vi.fn(async () => ({
        schemaVersion: 'place-suggestions.v1',
        sessionId: '01992d20-5000-7000-8000-000000000001',
        items: [], sources: [],
      })),
      selectSuggestion: vi.fn(async () => ({
        schemaVersion: 'place-suggestion-selection.v1',
        suggestionId: '01992d20-5000-7000-8000-000000000002',
        status: 'recorded',
        observationId: '01992d20-5000-7000-8000-000000000003',
      })),
      taxonomy: vi.fn(async () => ({ schemaVersion: 'place-taxonomy.v1', nodes: [] })),
    },
    createCorrelationRef: () => 'browser-search-ref',
  }
}

describe('browser search HTTP', () => {
  it('rejects malformed JSON before invoking the backend', async () => {
    const configured = dependencies()
    const http = createBrowserSearchHttp(configured)
    const response = await http.places(new Request('https://place.example/api/search/places', {
      method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PLACE_SEARCH_REQUEST_INVALID', correlationRef: 'browser-search-ref', retryable: false,
    })
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(configured.backend.places).not.toHaveBeenCalled()
  })

  it('rejects an oversized catalog map request before backend dispatch', async () => {
    const configured = dependencies()
    const response = await createBrowserSearchHttp(configured).catalogMap(new Request(
      'https://place.example/api/search/catalog/map',
      {
        method: 'POST', body: '{}',
        headers: { 'content-type': 'application/json', 'content-length': String(32 * 1_024 + 1) },
      },
    ))
    expect(response.status).toBe(400)
    expect(configured.backend.catalogMap).not.toHaveBeenCalled()
  })

  it('dispatches an antimeridian catalog list viewport instead of reporting it unavailable', async () => {
    const configured = dependencies()
    const bounds = { west: 170, south: -20, east: -170, north: 20 }
    const response = await createBrowserSearchHttp(configured).catalog(jsonRequest(
      '/api/search/catalog',
      {
        schemaVersion: 'catalog-place-search.v1',
        query: '태평양 여행',
        excludedTokenIds: [],
        bounds,
        limit: 20,
      },
    ))

    expect(response.status).toBe(200)
    expect(configured.backend.catalog).toHaveBeenCalledWith(
      expect.objectContaining({ bounds }),
      expect.any(AbortSignal),
    )
  })

  it('validates and dispatches every search command through one interface', async () => {
    const configured = dependencies()
    const http = createBrowserSearchHttp(configured)
    const requests = [
      http.catalogMap(jsonRequest('/api/search/catalog/map', {
        schemaVersion: 'catalog-place-map.v1', query: '', excludedTokenIds: [],
        viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 11,
      })),
      http.places(jsonRequest('/api/search/places', {
        schemaVersion: 'place-search.v1', query: '라멘',
      })),
      http.suggestions(jsonRequest('/api/search/suggestions', {
        schemaVersion: 'place-suggestions.v1', query: '라멘',
      })),
      http.selectSuggestion(jsonRequest('/api/search/suggestion-selections', {
        schemaVersion: 'place-suggestion-selection.v1',
        suggestionId: '01992d20-5000-7000-8000-000000000002',
      })),
    ]

    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(responses.every((response) => response.headers.get('cache-control') === 'no-store')).toBe(true)
    expect(configured.backend.catalogMap).toHaveBeenCalledOnce()
    expect(configured.backend.places).toHaveBeenCalledOnce()
    expect(configured.backend.suggestions).toHaveBeenCalledOnce()
    expect(configured.backend.selectSuggestion).toHaveBeenCalledOnce()
  })

  it('allowlists backend problem statuses and preserves safe evidence only', async () => {
    const configured = dependencies()
    configured.backend.selectSuggestion.mockRejectedValueOnce(
      new SearchBackendProblem(404, 'PLACE_SUGGESTION_NOT_FOUND', 'Suggestion not found', false, 'backend-ref'),
    )
    const response = await createBrowserSearchHttp(configured).selectSuggestion(
      jsonRequest('/api/search/suggestion-selections', {
        schemaVersion: 'place-suggestion-selection.v1',
        suggestionId: '01992d20-5000-7000-8000-000000000002',
      }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      type: 'urn:place:error:suggestion-not-found',
      title: 'Suggestion not found', status: 404,
      code: 'PLACE_SUGGESTION_NOT_FOUND', retryable: false, correlationRef: 'backend-ref',
    })
  })

  it('owns the bounded public taxonomy cache policy', async () => {
    const configured = dependencies()
    const response = await createBrowserSearchHttp(configured).taxonomy()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
