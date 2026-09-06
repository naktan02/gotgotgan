import { describe, expect, it } from 'vitest'
import { searchGeographicCatalog } from '../index.js'
import { geographicReferenceData } from '../adapters/geographic-catalog/reference-data.generated.js'
import { catalogExplorationResponseSchema } from '@place/contracts/search'

describe('public geographic reference catalog', () => {
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
    expect(searchGeographicCatalog('서울')[0]?.kind).toBe('city')
    expect(searchGeographicCatalog('a')).toEqual([])
  })
})
