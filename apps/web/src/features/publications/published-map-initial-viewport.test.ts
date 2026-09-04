import { describe, expect, it } from 'vitest'

import { createPublishedMapInitialViewport } from './published-map-initial-viewport'

describe('published Collection initial map viewport', () => {
  it('uses the minimum circular longitude arc across the antimeridian', () => {
    const viewport = createPublishedMapInitialViewport([
      { latitude: 35, longitude: 179 },
      { latitude: 35.2, longitude: -179 },
    ])

    expect(viewport.bounds.west).toBeCloseTo(178.7)
    expect(viewport.bounds.east).toBeCloseTo(-178.7)
    expect(viewport.bounds.west).toBeGreaterThan(viewport.bounds.east)
    expect(viewport.zoom).toBe(6)
  })

  it('clamps polar places to a non-empty Web Mercator latitude interval', () => {
    const north = createPublishedMapInitialViewport([{ latitude: 90, longitude: 20 }])
    const world = createPublishedMapInitialViewport([
      { latitude: -90, longitude: -20 },
      { latitude: 90, longitude: 20 },
    ])

    expect(north.bounds.north).toBe(85.051129)
    expect(north.bounds.south).toBeCloseTo(85.041129)
    expect(world.bounds.south).toBe(-85.051129)
    expect(world.bounds.north).toBe(85.051129)
  })

  it('uses a valid full-world Mercator viewport when no place has coordinates', () => {
    expect(createPublishedMapInitialViewport([])).toEqual({
      bounds: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
      zoom: 2,
    })
  })

  it('chooses zoom from padded bounds so a single known place leaves room for projected neighbors', () => {
    const viewport = createPublishedMapInitialViewport([
      { latitude: 37.5445, longitude: 127.056 },
    ])

    expect(viewport.bounds.west).toBeCloseTo(127.046)
    expect(viewport.bounds.south).toBeCloseTo(37.5345)
    expect(viewport.bounds.east).toBeCloseTo(127.066)
    expect(viewport.bounds.north).toBeCloseTo(37.5545)
    expect(viewport.zoom).toBe(12)
  })
})
