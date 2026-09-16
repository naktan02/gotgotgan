import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { centerForBounds, readMapViewport } from './map-viewport'

function mapWithBounds(input: Readonly<{
  west: number
  south: number
  east: number
  north: number
  zoom: number
}>): MapLibreMap {
  return {
    getBounds: () => ({
      getWest: () => input.west,
      getSouth: () => input.south,
      getEast: () => input.east,
      getNorth: () => input.north,
    }),
    getZoom: () => input.zoom,
  } as unknown as MapLibreMap
}

describe('MapLibre viewport projection', () => {
  it('clamps full-world globe bounds to the catalog Mercator contract', () => {
    expect(readMapViewport(mapWithBounds({
      west: -220, south: -90, east: 220, north: 90, zoom: 0,
    }))).toEqual({
      zoom: 0,
      bounds: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
    })
  })

  it('preserves an antimeridian-crossing viewport after normalization', () => {
    expect(readMapViewport(mapWithBounds({
      west: 170, south: -20, east: 190, north: 20, zoom: 4,
    })).bounds).toEqual({ west: 170, south: -20, east: -170, north: 20 })
    expect(centerForBounds({ west: 170, south: -20, east: -170, north: 20 })).toEqual([180, 0])
  })

  it('keeps a non-empty viewport at a polar edge', () => {
    expect(readMapViewport(mapWithBounds({
      west: -20, south: 86, east: 20, north: 90, zoom: 3,
    })).bounds).toEqual({
      west: -20, south: 85.051128, east: 20, north: 85.051129,
    })
  })
})
