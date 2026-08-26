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
      providerDetail: vi.fn(async () => ({
        schemaVersion: 'place-provider-detail.v1',
        providerKey: 'google', providerPlaceId: 'google-1', name: '라멘집',
        address: null, location: null, categoryLabel: null,
        photos: [], attributions: [], observedAt: '2026-08-26T10:00:00.000Z',
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

  it('validates and dispatches every search command through one interface', async () => {
    const configured = dependencies()
    const http = createBrowserSearchHttp(configured)
    const requests = [
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
      http.providerDetail(jsonRequest('/api/search/provider-details', {
        schemaVersion: 'place-provider-detail.v1',
        providerKey: 'google', providerPlaceId: 'google-1',
      })),
    ]

    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(responses.every((response) => response.headers.get('cache-control') === 'no-store')).toBe(true)
    expect(configured.backend.places).toHaveBeenCalledOnce()
    expect(configured.backend.suggestions).toHaveBeenCalledOnce()
    expect(configured.backend.selectSuggestion).toHaveBeenCalledOnce()
    expect(configured.backend.providerDetail).toHaveBeenCalledOnce()
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
