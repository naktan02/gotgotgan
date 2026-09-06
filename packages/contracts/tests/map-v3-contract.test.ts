import { describe, expect, it } from 'vitest'
import { mapFeatureV3Schema } from '../src/maps/index.js'
import { personalLibraryMapHttpQueryV2Schema, personalLibraryMapHttpQueryV3Schema,
  personalLibraryMapResponseV2Schema, personalLibraryMapResponseV3Schema } from '../src/library/index.js'
import { catalogPlaceMapResponseV2Schema, catalogPlaceMapResponseV3Schema } from '../src/search/index.js'

const id = (index: number) => `01992d20-4000-7000-8000-${String(index).padStart(12, '0')}`
const bounds = { west: 126, south: 37, east: 128, north: 38 }
const place = (index: number) => ({ kind: 'place' as const, placeId: id(index), label: '독립 장소',
  location: { latitude: 37.5, longitude: 127 }, classification: null })
const cluster = { kind: 'cluster' as const, clusterId: 'same-building', count: 2, location: place(2).location, bounds,
  coincidentPreview: { places: [place(2)], remainingCount: 1 } }
const library = { schemaVersion: 'personal-library-map.v3',
  filter: { favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
  viewport: { bounds, zoom: 12 }, features: [place(1), cluster],
  coverage: { representedPlaceCount: 3, unprojectedPlaceCount: 0, complete: true } }

describe('versioned mixed map presentation contracts', () => {
  it('keeps v2 strict while allowing a bounded v3 selection in the existing owner scope', () => {
    const request = { ...bounds, zoom: 12, selectedPlaceId: id(1) }
    expect(personalLibraryMapHttpQueryV3Schema.safeParse(request).success).toBe(true)
    expect(personalLibraryMapHttpQueryV2Schema.safeParse(request).success).toBe(false)
    expect(personalLibraryMapHttpQueryV3Schema.safeParse({ ...request, memberId: id(2) }).success).toBe(false)
    expect(personalLibraryMapResponseV3Schema.safeParse(library).success).toBe(true)
    expect(personalLibraryMapResponseV2Schema.safeParse({ ...library, schemaVersion: 'personal-library-map.v2' }).success).toBe(false)
  })
  it('requires exact coordinate preview remainder, no duplicate choices, and at most 20 previews', () => {
    expect(mapFeatureV3Schema.safeParse(cluster).success).toBe(true)
    for (const preview of [
      { places: [place(2)], remainingCount: 0 },
      { places: [place(2), place(2)], remainingCount: 0 },
      { places: [{ ...place(2), location: { latitude: 38, longitude: 127 } }], remainingCount: 1 },
      { places: Array.from({ length: 21 }, (_, index) => place(index + 1)), remainingCount: 0 },
    ]) expect(mapFeatureV3Schema.safeParse({ ...cluster, coincidentPreview: preview }).success).toBe(false)
  })
  it('does not accept oversized or incomplete Library and Catalog map responses', () => {
    expect(personalLibraryMapResponseV3Schema.safeParse({ ...library,
      features: Array.from({ length: 501 }, (_, index) => place(index)), coverage: { ...library.coverage, representedPlaceCount: 501 } }).success).toBe(false)
    const catalog = { schemaVersion: 'catalog-place-map.v3', interpretation: { normalizedQuery: '', tokens: [] },
      viewport: bounds, zoom: 12, mode: 'mixed', features: library.features,
      coverage: { matchingPlaceCount: 3, representedPlaceCount: 3, complete: true } }
    expect(catalogPlaceMapResponseV3Schema.safeParse(catalog).success).toBe(true)
    expect(catalogPlaceMapResponseV2Schema.safeParse({ ...catalog, schemaVersion: 'catalog-place-map.v2' }).success).toBe(false)
    expect(catalogPlaceMapResponseV3Schema.safeParse({ ...catalog, coverage: { ...catalog.coverage, representedPlaceCount: 2 } }).success).toBe(false)
    expect(catalogPlaceMapResponseV3Schema.safeParse({ ...catalog,
      features: Array.from({ length: 385 }, (_, index) => place(index)), coverage: { matchingPlaceCount: 385, representedPlaceCount: 385, complete: true } }).success).toBe(false)
  })
})
