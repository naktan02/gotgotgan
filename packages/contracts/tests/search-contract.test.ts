import { describe, expect, it } from 'vitest'

import {
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
})
