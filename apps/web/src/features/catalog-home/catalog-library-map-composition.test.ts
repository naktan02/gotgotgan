import type { PersonalLibraryMapResponseV4 } from '@place/contracts/library'
import { describe, expect, it } from 'vitest'

import type { PlaceMapCluster, PlaceMapMarker } from '@/platform/maps/public'

import { composeCatalogAndLibraryMap } from './catalog-library-map-composition'

const placeId = '550e8400-e29b-41d4-a716-446655440000'
const collectionId = 'd2719f7f-26e7-4ccf-afd1-8c1c066bb6f1'

const libraryProjection: PersonalLibraryMapResponseV4 = {
  schemaVersion: 'personal-library-map.v4',
  selection: { kind: 'collections', collectionIds: [collectionId] },
  filter: { ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
  selectedCollections: [{ collectionId, name: '다시 갈 곳', colorToken: 'coral' }],
  viewport: { bounds: { west: 126, south: 37, east: 128, north: 38 }, zoom: 12 },
  features: [{
    kind: 'place', placeId, label: '저장 당시 이름',
    location: { latitude: 37.5, longitude: 127 },
    classification: null,
    memberships: [{ collectionId, name: '다시 갈 곳', colorToken: 'coral' }],
  }],
  coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
}

describe('Catalog and personal Library map composition', () => {
  it('keeps one canonical marker and decorates it with Collection membership', () => {
    const catalogMarkers: readonly PlaceMapMarker[] = [{
      id: placeId, label: '현재 카탈로그 이름',
      location: { latitude: 37.5, longitude: 127 },
      classification: {
        primaryTaxonomy: { key: 'culture.gallery', label: '전시 공간' },
        rootTaxonomy: { key: 'culture', label: '문화' },
      },
    }]

    const result = composeCatalogAndLibraryMap({
      catalogMarkers,
      catalogClusters: [],
      libraryProjection,
      showLibrary: true,
    })

    expect(result.markers).toEqual([{
      ...catalogMarkers[0],
      accentColors: ['#c15f45'],
      membershipLabels: ['다시 갈 곳'],
    }])
  })

  it('keeps the Library projection hidden while its Collection metadata is loaded', () => {
    const catalogClusters: readonly PlaceMapCluster[] = [{
      id: 'catalog:1', count: 2,
      location: { latitude: 37.5, longitude: 127 },
      bounds: { west: 126, south: 37, east: 128, north: 38 },
    }]

    expect(composeCatalogAndLibraryMap({
      catalogMarkers: [], catalogClusters, libraryProjection, showLibrary: false,
    })).toEqual({ markers: [], clusters: catalogClusters })
  })
})
