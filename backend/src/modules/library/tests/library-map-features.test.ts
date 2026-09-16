import { describe, expect, it } from 'vitest'

import { projectLibraryMapFeatures } from '../application/library-map-features.js'
import type { LibraryPlaceSummary } from '../domain/queries.js'

const bounds = { west: 126.90, south: 37.50, east: 127.10, north: 37.60 }

function place(index: number, latitude: number, longitude: number): LibraryPlaceSummary {
  return {
    placeId: `place-${index}`,
    name: `장소 ${index}`,
    areaLabel: null,
    location: { latitude, longitude },
    primaryTaxonomy: null,
    taxonomyKeys: [],
    evidence: { status: 'verified', projectedAt: '2026-08-29T00:00:00.000Z' },
  }
}

describe('Library map feature projection', () => {
  it('keeps exact crossing coverage and stable integer buckets at fractional zoom', () => {
    const crossing = { west: 170, south: -10, east: -170, north: 10 }
    const features = projectLibraryMapFeatures({
      bounds: crossing,
      zoom: 12.5,
      places: [
        place(1, 1, 179.1),
        place(2, 1.01, 179.11),
        place(3, 2, -179.1),
        place(4, 2, 0),
      ],
    })
    const represented = features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0)

    expect(represented).toBe(3)
    expect(features).toHaveLength(2)
    expect(features).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cluster', clusterId: expect.stringMatching(/^z12-/), count: 2 }),
      expect.objectContaining({ kind: 'place', placeId: 'place-3' }),
    ]))
    const cluster = features.find((feature) => feature.kind === 'cluster')
    expect(cluster?.location.longitude).toBeGreaterThan(179)
    if (cluster?.kind === 'cluster') {
      expect(cluster.bounds.west).not.toBe(cluster.bounds.east)
      expect(cluster.bounds.south).toBeLessThan(cluster.bounds.north)
    }
  })

  it('accepts a full-world viewport without dropping edge longitudes', () => {
    const features = projectLibraryMapFeatures({
      bounds: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
      zoom: 18.25,
      places: [place(1, 0, -180), place(2, 0, 180)],
    })
    expect(features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0)).toBe(2)
  })

  it('represents nearby places as one count-bearing cluster', () => {
    const features = projectLibraryMapFeatures({
      bounds,
      zoom: 11,
      places: [place(1, 37.55, 126.95), place(2, 37.5501, 126.9501)],
    })

    expect(features).toHaveLength(1)
    expect(features[0]).toMatchObject({ kind: 'cluster', count: 2 })
    if (features[0]?.kind === 'cluster') {
      expect(features[0].bounds.west).toBeLessThan(features[0].bounds.east)
      expect(features[0].bounds.south).toBeLessThan(features[0].bounds.north)
    }
  })

  it('keeps separated places individually selectable when zoomed in', () => {
    const features = projectLibraryMapFeatures({
      bounds,
      zoom: 18,
      places: [place(1, 37.52, 126.92), place(2, 37.58, 127.08)],
    })

    expect(features.map((feature) => feature.kind)).toEqual(['place', 'place'])
  })

  it('caps visual features without dropping represented places', () => {
    const places = Array.from({ length: 1_000 }, (_, index) => place(
      index,
      bounds.south + ((index % 100) / 100) * (bounds.north - bounds.south),
      bounds.west + ((index % 97) / 97) * (bounds.east - bounds.west),
    ))
    const features = projectLibraryMapFeatures({ bounds, zoom: 18, places })
    const represented = features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0)

    expect(features.length).toBeLessThanOrEqual(500)
    expect(represented).toBe(1_000)
  })
})
