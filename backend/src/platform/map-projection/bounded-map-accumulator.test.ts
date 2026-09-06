import { describe, expect, it } from 'vitest'

import { createBoundedMapAccumulator } from './bounded-map-accumulator.js'
import { classifyMapFeatures } from './map-classification.js'
import { boundMapPreviews } from './bounded-map-previews.js'
import { mapPixelPosition, mapWorldPixels, type MapFeature, type MapPoint } from './pixel-projection.js'

const world = { west: -180, south: -90, east: 180, north: 90 }
const point = (id: number, latitude: number, longitude: number): MapPoint => ({
  kind: 'place', placeId: String(id).padStart(8, '0'), label: `장소 ${id}`,
  location: { latitude, longitude }, classification: null,
})
const count = (features: readonly MapFeature[]) => features.reduce((sum, feature) => sum + (feature.kind === 'place' ? 1 : feature.count), 0)

describe('bounded pixel map projection', () => {
  it('clamps polar rounding and fits all world edges into one feature even with a selection', () => {
    const pixels = mapWorldPixels(18.5)
    expect(mapPixelPosition({ latitude: 90, longitude: -180 }, world, pixels).y).toBe(0)
    expect(mapPixelPosition({ latitude: -90, longitude: 180 }, world, pixels).y).toBe(pixels)
    const accumulator = createBoundedMapAccumulator({ bounds: world, zoom: 18.5, maxFeatures: 1, selectedPlaceId: point(1, 90, -180).placeId })
    accumulator.add(point(1, 90, -180))
    accumulator.add(point(2, -90, 180))
    accumulator.add(point(3, 0, 0))
    expect(accumulator.finish()).toHaveLength(1)
    expect(count(accumulator.finish())).toBe(3)
    const polarBounds = { ...world, north: 85.051129 }
    const coincident = createBoundedMapAccumulator({ bounds: polarBounds, zoom: 18.5, maxFeatures: 500 })
    coincident.add(point(1, 85.05112878, 0))
    coincident.add(point(2, 85.05112878, 0))
    expect(coincident.finish()[0]).toMatchObject({ bounds: { north: polarBounds.north } })
  })
  it('bounds response-wide preview metadata while retaining an exact remainder for every coordinate group', () => {
    const accumulator = createBoundedMapAccumulator({ bounds: world, zoom: 18, maxFeatures: 500 })
    for (let group = 0; group < 100; group += 1) for (let index = 0; index < 30; index += 1) {
      accumulator.add(point(group * 100 + index, group / 10, 127))
    }
    const features = boundMapPreviews(accumulator.finish(), 500)
    expect(features.reduce((sum, feature) => sum + (feature.kind === 'place' ? 1 : feature.coincidentPreview?.places.length ?? 0), 0)).toBeLessThanOrEqual(500)
    expect(count(features)).toBe(3000)
    expect(features.every((feature) => feature.kind === 'place' || (feature.coincidentPreview?.places.length ?? 0) >= 1)).toBe(true)
  })
  it('keeps low zoom places separate when their screen pixels are apart, and merges only nearby dots', () => {
    const accumulator = createBoundedMapAccumulator({ bounds: world, zoom: 5, maxFeatures: 500 })
    accumulator.add(point(1, 37.5, 127))
    accumulator.add(point(2, 37.500001, 127.000001))
    accumulator.add(point(3, 35.2, 129))
    const features = accumulator.finish()
    expect(features).toHaveLength(2)
    expect(count(features)).toBe(3)
    expect(features.find((feature) => feature.kind === 'cluster')).toMatchObject({ count: 2, coincidentPreview: null })
  })
  it('retains 20 same-coordinate choices and an exact remainder, with selected Place outside the cluster', () => {
    const accumulator = createBoundedMapAccumulator({ bounds: world, zoom: 19, maxFeatures: 500, selectedPlaceId: point(30, 0, 0).placeId })
    for (let index = 0; index < 45; index += 1) accumulator.add(point(index, 37.5, 127))
    const features = accumulator.finish()
    expect(features).toHaveLength(2)
    expect(features[0]).toMatchObject({ kind: 'place', placeId: '00000030' })
    expect(count(features)).toBe(45)
    const cluster = features.find((feature) => feature.kind === 'cluster')
    if (cluster?.kind !== 'cluster') throw new Error('Expected cluster')
    expect(cluster.coincidentPreview?.places).toHaveLength(20)
    expect(cluster.coincidentPreview?.remainingCount).toBe(24)
    expect(cluster.coincidentPreview?.places.some((place) => place.placeId === '00000030')).toBe(false)
  })
  it('bounds 100,000 input points without truncating coverage or leaking out-of-bounds points', () => {
    const accumulator = createBoundedMapAccumulator({ bounds: world, zoom: 13, maxFeatures: 500 })
    for (let index = 0; index < 100_000; index += 1) accumulator.add(point(index, -70 + index % 1400 / 10, -179 + index % 3580 / 10))
    const features = accumulator.finish()
    expect(features.length).toBeLessThanOrEqual(500)
    expect(count(features)).toBe(100_000)
    expect(new Set(features.map((feature) => feature.kind === 'place' ? feature.placeId : feature.clusterId)).size).toBe(features.length)
  })
  it('uses the short dateline span and preserves fractional zoom', () => {
    const accumulator = createBoundedMapAccumulator({ bounds: { west: 170, east: -170, south: -10, north: 10 }, zoom: 6.5, maxFeatures: 500 })
    accumulator.add(point(1, 1, 179.99))
    accumulator.add(point(2, 1, -179.99))
    accumulator.add(point(3, 1, 0))
    expect(count(accumulator.finish())).toBe(2)
    expect(accumulator.finish().every((feature) => Math.abs(feature.location.longitude) > 170)).toBe(true)
  })
  it('derives the root from registered parents, not key spelling or unknown raw labels', async () => {
    const features = await classifyMapFeatures([
      { ...point(1, 37, 127), classification: { primaryTaxonomy: { key: 'unusual.ramen', label: '라멘' }, rootTaxonomy: null } },
      point(2, 37, 128),
    ], async () => [{ key: 'food', label: '음식점', parentKey: null }, { key: 'unusual.ramen', label: '라멘', parentKey: 'food' }])
    expect(features[0]).toMatchObject({ classification: { rootTaxonomy: { key: 'food', label: '음식점' } } })
    expect(features[1]).toMatchObject({ classification: null })
  })
})
