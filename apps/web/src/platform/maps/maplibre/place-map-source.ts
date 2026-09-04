import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

import type {
  PlaceMapCluster,
  PlaceMapMarker,
} from '../place-map-interface'

export const PLACE_SOURCE_ID = 'gotgotgan-places'
export const PLACE_LAYER_ID = 'gotgotgan-place-points'
export const CLUSTER_LAYER_ID = 'gotgotgan-place-clusters'

type PlaceFeatureCollection = Readonly<{
  type: 'FeatureCollection'
  features: readonly Readonly<{
    type: 'Feature'
    geometry: Readonly<{ type: 'Point'; coordinates: readonly [number, number] }>
    properties: Readonly<{
      featureId: string
      kind: 'place' | 'cluster'
      count: number
      selected: boolean
    }>
  }>[]
}>

export function createPlaceFeatureCollection(
  markers: readonly PlaceMapMarker[],
  clusters: readonly PlaceMapCluster[],
  selectedMarkerId: string | undefined,
): PlaceFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...clusters.map((cluster) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [cluster.location.longitude, cluster.location.latitude] as const,
        },
        properties: {
          featureId: cluster.id,
          kind: 'cluster' as const,
          count: cluster.count,
          selected: false,
        },
      })),
      ...markers.map((marker) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [marker.location.longitude, marker.location.latitude] as const,
        },
        properties: {
          featureId: marker.id,
          kind: 'place' as const,
          count: 1,
          selected: marker.id === selectedMarkerId,
        },
      })),
    ],
  }
}

export function installPlaceSource(map: MapLibreMap, data: PlaceFeatureCollection): void {
  map.addSource(PLACE_SOURCE_ID, {
    type: 'geojson',
    data: data as unknown as Parameters<GeoJSONSource['setData']>[0],
  })
  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: 'circle',
    source: PLACE_SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'cluster'],
    paint: {
      'circle-color': '#1768e5',
      'circle-opacity': 0.4,
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 15, 384, 36],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: PLACE_LAYER_ID,
    type: 'circle',
    source: PLACE_SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'place'],
    paint: {
      'circle-color': ['case', ['get', 'selected'], '#0f4ca6', '#1768e5'],
      'circle-radius': ['case', ['get', 'selected'], 10, 8],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}

export function updatePlaceSource(map: MapLibreMap, data: PlaceFeatureCollection): void {
  const source = map.getSource<GeoJSONSource>(PLACE_SOURCE_ID)
  source?.setData(data as unknown as Parameters<GeoJSONSource['setData']>[0])
}
