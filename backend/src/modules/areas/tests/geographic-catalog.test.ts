import { describe, expect, it } from 'vitest'
import { searchGeographicCatalog, searchLegacyGeographicCatalog } from '../index.js'
import { geographicReferenceData } from '../adapters/geographic-catalog/reference-data.generated.js'
import { catalogExplorationResponseSchema, catalogExplorationResponseV2Schema } from '@place/contracts/search'
import reference from '../adapters/geographic-catalog/korea-reference-data.generated.json' with { type: 'json' }

describe('public geographic reference catalog', () => {
  it('preserves v1 scope and supplies bounded, distinguishable same-name regional candidates in v2', () => {
    expect(searchLegacyGeographicCatalog('경기도')).toEqual([])
    expect(searchLegacyGeographicCatalog('서울').map((item) => item.kind)).toEqual(['city'])
    const named = searchGeographicCatalog('성수동', 20).filter((item) => item.name === '성수동')
    expect(named.length).toBeGreaterThan(1)
    expect(new Set(named.map((item) => item.contextLabel)).size).toBe(named.length)
    expect(searchGeographicCatalog('동', 20)).toEqual([])
    expect(searchGeographicCatalog('서울', 10_000).length).toBeLessThanOrEqual(20)
  })
  it('validates all frozen Korean points, identities, coverage and source provenance', () => {
    expect(reference.destinations).toHaveLength(13_853)
    expect(new Set(reference.destinations.map((item) => item.key)).size).toBe(reference.destinations.length)
    for (const item of reference.destinations) {
      const { names, ...destination } = item
      expect(names.length).toBeGreaterThan(0)
      expect(item.bounds).toBeNull()
      expect(catalogExplorationResponseV2Schema.safeParse({
        schemaVersion: 'catalog-exploration.v2', intent: 'name', places: [], conditions: [], unrecognizedText: '',
        destinations: [{ ...destination, exact: false }],
      }).success, item.key).toBe(true)
    }
    expect(JSON.stringify(reference.metadata)).toContain('779f04b1fca93aa724da5e740e3a6b282065158805c06a3b0bae71b16e7594ac')
  })
  it('finds Korean province, municipality and neighborhood identities from the frozen reference', () => {
    expect(searchGeographicCatalog('경기도')[0]).toMatchObject({ key: 'geonames:1841610', kind: 'administrative-area', name: '경기도', bounds: null })
    expect(searchGeographicCatalog('양주시')[0]).toMatchObject({ key: 'geonames:8393804', kind: 'locality', name: '양주시' })
    const seongsu = searchGeographicCatalog('서울 성수동').find((item) => item.key === 'geonames:1836016')
    expect(seongsu).toMatchObject({ kind: 'neighborhood', name: '성수동', bounds: null })
    expect(seongsu?.location.latitude).toBeGreaterThan(37)
  })
  it('validates all country geometries and city points without inventing city boundaries', () => {
    expect(geographicReferenceData.length).toBe(420)
    for (const item of geographicReferenceData) {
      const { names: _names, ...destination } = item
      expect(catalogExplorationResponseSchema.safeParse({
        schemaVersion: 'catalog-exploration.v1', intent: 'name', places: [], conditions: [], unrecognizedText: '',
        destinations: [{ ...destination, exact: true }],
      }).success, item.name).toBe(true)
      if (item.kind === 'city') expect(item.bounds).toBeNull()
    }
  })
  it('matches localized country names and limits partial results', () => {
    expect(searchGeographicCatalog('대한민국')[0]?.name).toBe('대한민국')
    expect(searchLegacyGeographicCatalog('서울')[0]?.kind).toBe('city')
    expect(searchGeographicCatalog('서울')[0]?.name).toContain('서울')
    expect(searchGeographicCatalog('a')).toEqual([])
  })
})
