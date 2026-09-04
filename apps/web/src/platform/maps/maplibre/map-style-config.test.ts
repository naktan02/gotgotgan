import { describe, expect, it } from 'vitest'

import { resolvePlaceMapStyleUrl } from './map-style-config'

describe('MapLibre style runtime configuration', () => {
  it('defaults production to OpenFreeMap and E2E to the local style', () => {
    expect(resolvePlaceMapStyleUrl(undefined, undefined)).toBe(
      'https://tiles.openfreemap.org/styles/liberty',
    )
    expect(resolvePlaceMapStyleUrl(undefined, 'http://127.0.0.1:3410')).toBe('/api/maps/style')
    expect(resolvePlaceMapStyleUrl(
      'https://maps.production.example/style.json', 'http://127.0.0.1:3410',
    )).toBe('/api/maps/style')
  })

  it('allows query-free same-origin paths and public OpenFreeMap styles only', () => {
    expect(resolvePlaceMapStyleUrl('/maps/style.json', undefined)).toBe('/maps/style.json')
    expect(resolvePlaceMapStyleUrl('https://tiles.openfreemap.org/styles/bright', undefined)).toBe(
      'https://tiles.openfreemap.org/styles/bright',
    )
    expect(() => resolvePlaceMapStyleUrl('http://maps.example/style.json', undefined)).toThrow()
    expect(() => resolvePlaceMapStyleUrl('https://maps.example/style.json', undefined)).toThrow()
    expect(() => resolvePlaceMapStyleUrl('//maps.example/style.json', undefined)).toThrow()
    expect(() => resolvePlaceMapStyleUrl('/maps/style.json?token=secret', undefined)).toThrow()
    expect(() => resolvePlaceMapStyleUrl(
      'https://tiles.openfreemap.org/styles/liberty?token=secret', undefined,
    )).toThrow()
    expect(() => resolvePlaceMapStyleUrl('https://user:secret@maps.example/style.json', undefined)).toThrow()
  })
})
