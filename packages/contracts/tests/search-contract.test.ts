import { describe, expect, it } from 'vitest'

import {
  catalogPlaceMapRequestSchema,
  catalogPlaceMapResponseSchema,
  catalogPlaceSearchRequestSchema,
  catalogPlaceSearchResponseSchema,
  placeSearchRequestSchema,
  placeSuggestionMaterializationResponseSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsResponseSchema,
  placeSearchResponseSchema,
  providerPlaceDetailSchema,
} from '../src/search/index.js'

describe('provider-neutral search contracts', () => {
  it('bounds map features while preserving exact antimeridian viewport coverage', () => {
    const request = catalogPlaceMapRequestSchema.parse({
      schemaVersion: 'catalog-place-map.v1',
      query: '도쿄 관광지',
      viewport: { west: 170, south: -20, east: -170, north: 20 },
      zoom: 4.5,
    })
    expect(request.maxFeatures).toBe(384)
    expect(catalogPlaceMapRequestSchema.safeParse({
      ...request,
      viewport: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
    }).success).toBe(true)
    expect(catalogPlaceMapRequestSchema.safeParse({
      ...request,
      viewport: { west: 10, south: -20, east: 10, north: 20 },
    }).success).toBe(false)
    expect(catalogPlaceMapRequestSchema.safeParse({
      ...request,
      viewport: { west: 170, south: -85.05113, east: -170, north: 20 },
    }).success).toBe(false)
    expect(catalogPlaceMapRequestSchema.safeParse({
      ...request,
      viewport: { west: 180, south: -20, east: -180, north: 20 },
    }).success).toBe(false)
    expect(catalogPlaceMapRequestSchema.safeParse({
      ...request,
      maxFeatures: 385,
    }).success).toBe(false)

    const response = catalogPlaceMapResponseSchema.parse({
      schemaVersion: 'catalog-place-map.v1',
      interpretation: { normalizedQuery: '', tokens: [] },
      viewport: request.viewport,
      zoom: request.zoom,
      mode: 'clusters',
      features: [{
        kind: 'cluster',
        featureId: 'cluster:4:0:0',
        location: { latitude: 1, longitude: 179 },
        bounds: { west: 170, south: -20, east: -170, north: 20 },
        placeCount: 12,
      }],
      coverage: {
        matchingPlaceCount: 12,
        representedPlaceCount: 12,
        complete: true,
      },
    })
    expect(response.coverage.complete).toBe(true)
    expect(catalogPlaceMapResponseSchema.safeParse({
      ...response,
      coverage: { ...response.coverage, matchingPlaceCount: 13 },
    }).success).toBe(false)
  })

  it('keeps home catalog search canonical-only and version-pins interpreted meaning', () => {
    const request = catalogPlaceSearchRequestSchema.parse({
      schemaVersion: 'catalog-place-search.v1',
      query: '성수 조용한 라멘',
      excludedTokenIds: ['attribute:bW9vZC5xdWlldA:2'],
      bounds: { west: 170, south: -20, east: -170, north: 20 },
    })
    expect(request.bounds).toEqual({ west: 170, south: -20, east: -170, north: 20 })
    expect(catalogPlaceSearchRequestSchema.safeParse({
      ...request,
      bounds: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
    }).success).toBe(true)
    expect(catalogPlaceSearchRequestSchema.safeParse({
      ...request,
      bounds: { west: 180, south: -20, east: -180, north: 20 },
    }).success).toBe(false)
    expect(catalogPlaceSearchRequestSchema.safeParse({
      ...request,
      bounds: { west: 10, south: -20, east: 10, north: 20 },
    }).success).toBe(false)
    expect(catalogPlaceSearchRequestSchema.safeParse({
      ...request,
      bounds: { west: 170, south: -85.05113, east: -170, north: 20 },
    }).success).toBe(false)
    expect(placeSearchRequestSchema.safeParse({
      schemaVersion: 'place-search.v1', query: '',
      bounds: { west: 170, south: -20, east: -170, north: 20 },
    }).success).toBe(false)
    const response = catalogPlaceSearchResponseSchema.parse({
      schemaVersion: 'catalog-place-search.v1',
      interpretation: {
        normalizedQuery: '',
        tokens: [
          { tokenId: 'area:c2VvdWwuY2hpbGQuMQ:3', kind: 'area', key: 'seoul.child.1', version: 3, label: '성수' },
          { tokenId: 'place-type:Zm9vZC5ub29kbGUucmFtZW4:4', kind: 'place-type', key: 'food.noodle.ramen', version: 4, label: '라멘' },
        ],
      },
      items: [{
        placeId: '01992d20-0000-7000-8000-000000000101',
        name: '조용한 라멘 연구소',
        area: {
          label: '성수',
          reference: { key: 'seoul.child.1', version: 3 },
        },
        location: { latitude: 37.5445, longitude: 127.056 },
        primaryTaxonomy: { key: 'food.noodle.ramen', version: 4, label: '라멘' },
        taxonomyReferences: [
          { key: 'food.noodle.ramen', version: 4, kind: 'category' },
          { key: 'mood.quiet', version: 2, kind: 'attribute' },
        ],
        evidenceStatus: 'verified',
        projectedAt: '2026-08-26T10:00:00.000Z',
      }, {
        placeId: '01992d20-0000-7000-8000-000000000102',
        name: '좌표 검수 중인 장소',
        area: null,
        location: null,
        primaryTaxonomy: null,
        taxonomyReferences: [],
        evidenceStatus: 'unverified',
        projectedAt: '2026-08-26T10:00:00.000Z',
      }],
      mapBounds: { west: 127.0555, south: 37.544, east: 127.0565, north: 37.545 },
    })

    expect(request.excludedTokenIds).toHaveLength(1)
    expect(response.items[0]).not.toHaveProperty('identity')
    expect(response.items[0]).not.toHaveProperty('source')
    expect(response.items[0]).not.toHaveProperty('saved')
    expect(response.items[0]).not.toHaveProperty('wanted')
    expect(response.items[1]?.location).toBeNull()
    expect(response.interpretation.tokens[0]).toMatchObject({
      kind: 'area', key: 'seoul.child.1', version: 3,
    })
  })

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
