import type { Map as MapLibreMap } from 'maplibre-gl'

import type {
  PlaceMapBounds,
  PlaceMapViewport,
} from '../place-map-interface'

function normalizeLongitude(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return normalized === -180 && value > 0 ? 180 : normalized
}

const MAX_MERCATOR_LATITUDE = 85.051129

function mercatorLatitudes(south: number, north: number): readonly [number, number] {
  const clampedSouth = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, south))
  const clampedNorth = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, north))
  if (clampedSouth < clampedNorth) return [clampedSouth, clampedNorth]
  return south >= MAX_MERCATOR_LATITUDE
    ? [MAX_MERCATOR_LATITUDE - 0.000001, MAX_MERCATOR_LATITUDE]
    : [-MAX_MERCATOR_LATITUDE, -MAX_MERCATOR_LATITUDE + 0.000001]
}

export function centerForBounds(bounds: PlaceMapBounds): [number, number] {
  const east = bounds.west > bounds.east ? bounds.east + 360 : bounds.east
  return [
    normalizeLongitude((bounds.west + east) / 2),
    (bounds.south + bounds.north) / 2,
  ]
}

export function readMapViewport(map: MapLibreMap): PlaceMapViewport {
  const bounds = map.getBounds()
  const west = bounds.getWest()
  const east = bounds.getEast()
  const [south, north] = mercatorLatitudes(bounds.getSouth(), bounds.getNorth())
  if (east - west >= 360) {
    return {
      zoom: map.getZoom(),
      bounds: { west: -180, south, east: 180, north },
    }
  }
  return {
    zoom: map.getZoom(),
    bounds: {
      west: normalizeLongitude(west),
      south,
      east: normalizeLongitude(east),
      north,
    },
  }
}
