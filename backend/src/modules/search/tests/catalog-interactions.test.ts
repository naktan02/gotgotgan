import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { createCatalogExploration, createCatalogPlaceSearch, createCatalogPlaceMapSearch, registerSearchHttpRoutes, type CatalogPlaceSearchQuery, type CatalogPlaceMapQuery } from '../index.js'
import { catalogExplorationResponseSchema } from '@place/contracts/search'

const vocabulary = {
  listAreas: async () => [{ key: 'seongsu', version: 1, parentKey: null, names: [{ languageTag: 'ko', name: '성수동' }], defaultLanguageTag: 'ko' }],
  listTaxonomies: async () => [{ key: 'ramen', version: 1, parentKey: null, label: '쇼유라멘', kind: 'category' as const }],
}
const searchGeographicCatalog = () => [{ key: 'fixture:korea', kind: 'country' as const, name: '대한민국', names: ['대한민국'], countryCode: 'KR',
  location: { latitude: 36, longitude: 128 }, bounds: { west: 124, south: 33, east: 130, north: 39 } }]
describe('named destinations and conditions are separate intentions', () => {
  it('finds 대한민국 internally with real geometry and never makes a place or filter', async () => {
    const explore = createCatalogExploration({ vocabulary, destinations: searchGeographicCatalog, source: { searchCatalog: async () => ({ items: [] }) } })
    const result = catalogExplorationResponseSchema.parse(await explore('대한민국'))
    expect(result.intent).toBe('name')
    expect(result.destinations[0]).toMatchObject({ name: '대한민국', exact: true, kind: 'country' })
    expect(result.destinations[0]?.bounds).not.toBeNull()
    expect(result.conditions).toEqual([])
    expect(result.places).toEqual([])
  })
  it('retains recognized conditions and unrecognized evidence instead of claiming child friendliness', async () => {
    const explore = createCatalogExploration({ vocabulary, destinations: () => [], source: { searchCatalog: async () => ({ items: [] }) } })
    const result = await explore('아이와 함께 갈 수 있는 성수동 쇼유라멘')
    expect(result.intent).toBe('conditions')
    expect(result.conditions.map((token) => token.label)).toEqual(['성수동', '쇼유라멘'])
    expect(result.unrecognizedText).toContain('아이와')
  })
  it('lets a name equal to a taxonomy label remain a literal name without bounding it to the viewport', async () => {
    const searchCatalog = vi.fn(async (_query: CatalogPlaceSearchQuery) => ({ items: [] }))
    const search = createCatalogPlaceSearch({ vocabulary, source: { searchCatalog } })
    await search({ query: '쇼유라멘', intent: 'name', excludedTokenIds: [], limit: 20 })
    expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ query: '쇼유라멘', taxonomyReferences: [] }))
    expect(searchCatalog.mock.calls[0]?.[0]).not.toHaveProperty('bounds')
  })
  it('preserves punctuation in explicit public names', async () => {
    const searchCatalog = vi.fn(async (_query: CatalogPlaceSearchQuery) => ({ items: [] }))
    await createCatalogPlaceSearch({ vocabulary, source: { searchCatalog } })({
      query: '100% Coffee & Tea', intent: 'name', excludedTokenIds: [], limit: 20,
    })
    expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({ query: '100% coffee & tea' }))
  })
  it('uses the selected current taxonomy key rather than an ambiguous sibling label', async () => {
    const searchCatalog = vi.fn(async (_query: CatalogPlaceSearchQuery) => ({ items: [] }))
    const duplicateLabels = {
      ...vocabulary,
      listTaxonomies: async () => [
        { key: 'food', version: 2, parentKey: null, label: '음식점', kind: 'category' as const },
        { key: 'food.special', version: 7, parentKey: 'food', label: '특선', kind: 'category' as const },
        { key: 'food.special.ramen', version: 3, parentKey: 'food.special', label: '라멘', kind: 'category' as const },
        { key: 'culture.special', version: 5, parentKey: null, label: '특선', kind: 'category' as const },
      ],
    }
    const search = createCatalogPlaceSearch({ vocabulary: duplicateLabels, source: { searchCatalog } })
    const response = await search({ query: '', taxonomyKey: 'food.special', excludedTokenIds: [], limit: 20 })
    expect(response.interpretation.tokens).toEqual([expect.objectContaining({ key: 'food.special', version: 7, label: '특선' })])
    expect(searchCatalog).toHaveBeenCalledWith(expect.objectContaining({
      taxonomyReferenceGroups: [[
        { key: 'food.special', version: 7, kind: 'category' },
        { key: 'food.special.ramen', version: 3, kind: 'category' },
      ]],
    }))
    await expect(search({ query: '', taxonomyKey: 'missing', excludedTokenIds: [], limit: 20 })).rejects.toMatchObject({ name: 'InvalidCatalogTaxonomyError' })
  })
  it('transports v2 name, near and exact taxonomy keys while preserving strict v1 requests', async () => {
    const searchCatalog = vi.fn(async (_query: CatalogPlaceSearchQuery) => ({ items: [] }))
    const projectCatalogMap = vi.fn(async (_query: CatalogPlaceMapQuery) => ({ mode: 'places' as const, features: [], matchingPlaceCount: 0 }))
    const app = Fastify({ logger: false })
    registerSearchHttpRoutes(app, {
      search: async () => ({ schemaVersion: 'place-search.v1', items: [], sources: [] }),
      catalog: createCatalogPlaceSearch({ vocabulary, source: { searchCatalog } }),
      catalogMap: createCatalogPlaceMapSearch({ vocabulary, source: { projectCatalogMap } }),
      explore: createCatalogExploration({ vocabulary, source: { searchCatalog }, destinations: () => [] }),
    })
    try {
      const near = { latitude: 37.5, longitude: 127 }
      const payload = { schemaVersion: 'catalog-place-search.v2', query: '쇼유라멘', intent: 'name', near, taxonomyKey: 'ramen' }
      const response = await app.inject({ method: 'POST', url: '/v2/search/catalog', payload })
      expect(response.statusCode).toBe(200)
      expect(response.json().schemaVersion).toBe('catalog-place-search.v2')
      expect(searchCatalog).toHaveBeenLastCalledWith(expect.objectContaining({
        intent: 'name', query: '쇼유라멘', near,
        taxonomyReferenceGroups: [[{ key: 'ramen', version: 1, kind: 'category' }]],
      }))
      expect(searchCatalog.mock.calls.at(-1)?.[0]).not.toHaveProperty('bounds')
      const mapPayload = { schemaVersion: 'catalog-place-map.v2', query: '쇼유라멘', intent: 'name', taxonomyKey: 'ramen',
        viewport: { west: 126, south: 37, east: 128, north: 38 }, zoom: 14 }
      const map = await app.inject({ method: 'POST', url: '/v2/search/catalog/map', payload: mapPayload })
      expect(map.statusCode).toBe(200)
      expect(map.json().schemaVersion).toBe('catalog-place-map.v2')
      expect(projectCatalogMap).toHaveBeenLastCalledWith(expect.objectContaining({
        intent: 'name', taxonomyReferenceGroups: [[{ key: 'ramen', version: 1, kind: 'category' }]],
      }))
      for (const [url, body] of [['/v2/search/catalog', payload], ['/v2/search/catalog/map', mapPayload]] as const) {
        const invalid = await app.inject({ method: 'POST', url, payload: { ...body, taxonomyKey: 'unknown' } })
        expect(invalid.statusCode).toBe(400)
        expect(invalid.json().code).toBe('PLACE_CATALOG_TAXONOMY_INVALID')
      }
      const exploration = await app.inject({ method: 'POST', url: '/v1/search/catalog/explore',
        payload: { schemaVersion: 'catalog-exploration.v1', query: '쇼유라멘', near } })
      expect(exploration.statusCode).toBe(200)
      expect(searchCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ intent: 'name', near, limit: 8 }))
      for (const extra of [{ near }, { taxonomyKey: 'ramen' }, { intent: 'name' }]) {
        const legacy = await app.inject({ method: 'POST', url: '/v1/search/catalog',
          payload: { schemaVersion: 'catalog-place-search.v1', query: '쇼유라멘', ...extra } })
        expect(legacy.statusCode).toBe(400)
      }
      const invalidNear = await app.inject({ method: 'POST', url: '/v2/search/catalog', payload: { ...payload, near: { latitude: 91, longitude: 127 } } })
      expect(invalidNear.statusCode).toBe(400)
    } finally { await app.close() }
  })
})
