import { describe, expect, it } from 'vitest'

import {
  placeSuggestionMaterializationResponseSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsResponseSchema,
  placeSearchResponseSchema,
  providerPlaceDetailSchema,
} from '../src/search/index.js'

describe('provider-neutral search contracts', () => {
  it('keeps external observations distinct from canonical places', () => {
    const parsed = placeSearchResponseSchema.parse({
      schemaVersion: 'place-search.v1',
      items: [{
        resultId: 'google:opaque-result',
        identity: { kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place' },
        source: {
          key: 'google', label: 'Google Maps', detailsAvailable: true,
          externalUri: 'https://maps.example/place',
          attributions: [{ label: 'Google Maps' }],
        },
        freshness: { kind: 'live', observedAt: '2026-08-26T10:00:00.000Z' },
        name: 'Provider result', areaLabel: 'Seoul',
        location: { latitude: 37.5, longitude: 127 },
        primaryTaxonomy: null, taxonomyKeys: [], evidenceStatus: 'unverified',
      }],
      sources: [{ sourceKey: 'google', status: 'complete', resultCount: 1 }],
    })

    expect(parsed.items[0]?.identity).toEqual({
      kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place',
    })
    expect(parsed.items[0]).not.toHaveProperty('placeId')
  })

  it('preserves provider and photo author attribution on lazy details', () => {
    const parsed = providerPlaceDetailSchema.parse({
      schemaVersion: 'place-provider-detail.v1',
      providerKey: 'google', providerPlaceId: 'google-place',
      name: 'Provider result', address: null, location: null, categoryLabel: null,
      photos: [{
        mediaUri: 'https://photos.example/media',
        authorAttributions: [{ label: 'Photo author', uri: 'https://authors.example/profile' }],
      }],
      attributions: [{ label: 'Google Maps', uri: 'https://maps.example/place' }],
      observedAt: '2026-08-26T10:00:00.000Z',
    })

    expect(parsed.photos[0]?.authorAttributions[0]?.label).toBe('Photo author')
  })

  it('rejects credential-bearing provider URLs at the browser contract', () => {
    expect(providerPlaceDetailSchema.safeParse({
      schemaVersion: 'place-provider-detail.v1',
      providerKey: 'google', providerPlaceId: 'google-place',
      name: 'Provider result', address: null, location: null, categoryLabel: null,
      externalUri: 'https://user:password@maps.example/place',
      photos: [], attributions: [{ label: 'Google Maps' }],
      observedAt: '2026-08-26T10:00:00.000Z',
    }).success).toBe(false)
  })

  it('publishes provider-neutral suggestions without provider session material', () => {
    const parsed = placeSuggestionsResponseSchema.parse({
      schemaVersion: 'place-suggestions.v1',
      sessionId: '01992d20-1000-7000-8000-000000000001',
      items: [{
        suggestionId: '01992d20-1000-7000-8000-000000000002',
        identity: {
          kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place-100',
        },
        source: {
          key: 'google', label: 'Google Maps', detailsAvailable: true,
          attributions: [{ label: 'Google Maps' }],
        },
        name: 'Senkai Ramen',
        areaLabel: 'Fukuoka, Japan',
        location: null,
        categoryLabel: 'Ramen restaurant',
        observedAt: '2026-08-26T10:00:00.000Z',
      }],
      sources: [{ sourceKey: 'google', status: 'complete', resultCount: 1 }],
    })

    expect(parsed.items[0]?.identity).toEqual({
      kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place-100',
    })
    expect(JSON.stringify(parsed)).not.toContain('sessionToken')
    expect(JSON.stringify(parsed)).not.toContain('apiKey')
    expect(JSON.stringify(parsed)).not.toContain('rawPayload')
  })

  it('keeps selection evidence and canonical materialization as separate contracts', () => {
    expect(placeSuggestionSelectionResponseSchema.parse({
      schemaVersion: 'place-suggestion-selection.v1',
      suggestionId: '01992d20-1000-7000-8000-000000000002',
      status: 'recorded',
      observationId: '01992d20-1000-7000-8000-000000000003',
    })).toMatchObject({ status: 'recorded' })

    expect(placeSuggestionMaterializationResponseSchema.parse({
      schemaVersion: 'place-suggestion-materialization.v1',
      suggestionId: '01992d20-1000-7000-8000-000000000002',
      status: 'created',
      canonicalPlaceId: '01992d20-1000-7000-8000-000000000004',
    })).toMatchObject({ status: 'created' })
  })
})
