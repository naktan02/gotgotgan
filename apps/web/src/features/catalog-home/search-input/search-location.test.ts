import { describe, expect, it } from 'vitest'
import { catalogSearchNear } from './search-location'

describe('catalog ranking location', () => {
  it('does not invent a nearby search around longitude zero for a globe-wide view', () => {
    expect(catalogSearchNear({ zoom: 1, bounds: { west: -180, east: 180, south: -80, north: 80 } })).toBeUndefined()
  })
  it('preserves date-line geography instead of making Greenwich the sorting origin', () => {
    expect(catalogSearchNear({ zoom: 6, bounds: { west: 179, east: -179, south: 30, north: 40 } })).toEqual({ longitude: -180, latitude: 35 })
  })
})
