import { describe, expect, it } from 'vitest'

import {
  createCatalogPlaceMapSearch,
  createCatalogPlaceSearch,
  interpretCatalogSearch,
  type CatalogPlaceSearchQuery,
  type CatalogPlaceSummary,
} from '../index.js'

const areas = [{
  key: 'kr.seoul.seongsu', version: 3, parentKey: 'kr.seoul',
  names: [{ languageTag: 'ko', name: '성수' }], defaultLanguageTag: 'ko',
}]
const taxonomies = [
  { key: 'place.cafe', version: 4, parentKey: null, label: '카페', kind: 'category' as const },
  { key: 'mood.quiet', version: 2, parentKey: null, label: '조용한', kind: 'attribute' as const },
]

const place: CatalogPlaceSummary = {
  placeId: '01992d20-0000-7000-8000-000000000101',
  name: '작업실 카페',
  area: { label: '성수', reference: { key: 'kr.seoul.seongsu', version: 3 } },
  location: { latitude: 37.5445, longitude: 127.056 },
  primaryTaxonomy: { key: 'place.cafe', version: 4, label: '카페' },
  taxonomyReferences: [
    { key: 'place.cafe', version: 4, kind: 'category' },
    { key: 'mood.quiet', version: 2, kind: 'attribute' },
  ],
  evidenceStatus: 'verified',
  projectedAt: '2026-08-26T10:00:00.000Z',
}

describe('canonical catalog home search', () => {
  it('reuses catalog interpretation and rejects incomplete map source coverage', async () => {
    const observed: unknown[] = []
    const mapSearch = createCatalogPlaceMapSearch({
      source: {
        projectCatalogMap: async (query) => {
          observed.push(query)
          return {
            mode: 'places',
            features: [{
              kind: 'place', featureId: `place:${place.placeId}`, placeId: place.placeId,
              name: place.name, location: place.location!, areaLabel: place.area!.label,
              primaryTaxonomy: { key: 'place.cafe', label: '카페' }, placeCount: 1,
            }],
            matchingPlaceCount: 1,
          }
        },
      },
      vocabulary: {
        listAreas: async () => areas,
        listTaxonomies: async () => taxonomies,
      },
    })
    const viewport = { west: 170, south: -20, east: -170, north: 20 }
    const response = await mapSearch({
      query: '성수 조용한 카페', excludedTokenIds: [], viewport, zoom: 14, maxFeatures: 384,
    })

    expect(observed).toEqual([expect.objectContaining({
      query: '',
      areaReferences: [{ key: 'kr.seoul.seongsu', version: 3 }],
      taxonomyReferenceGroups: [
        [{ key: 'place.cafe', version: 4, kind: 'category' }],
        [{ key: 'mood.quiet', version: 2, kind: 'attribute' }],
      ],
      viewport,
    })])
    expect(response.coverage).toEqual({
      matchingPlaceCount: 1, representedPlaceCount: 1, complete: true,
    })
    expect(response.interpretation.tokens.map((token) => token.kind)).toEqual([
      'area', 'place-type', 'attribute',
    ])

    const incomplete = createCatalogPlaceMapSearch({
      source: {
        projectCatalogMap: async () => ({
          mode: 'clusters', features: [], matchingPlaceCount: 1,
        }),
      },
      vocabulary: { listAreas: async () => [], listTaxonomies: async () => [] },
    })
    await expect(incomplete({
      query: '', excludedTokenIds: [], viewport, zoom: 1, maxFeatures: 384,
    })).rejects.toThrow('incomplete coverage')
  })

  it('deterministically interprets versioned Area, place type, attribute, and residual query', () => {
    const first = interpretCatalogSearch(
      '성수에서 작업하기 좋은 조용한 카페',
      [],
      areas,
      taxonomies,
    )
    const second = interpretCatalogSearch(
      '성수에서 작업하기 좋은 조용한 카페',
      [],
      areas,
      taxonomies,
    )

    expect(second).toEqual(first)
    expect(first.tokens.map((token) => token.kind)).toEqual([
      'area', 'place-type', 'attribute', 'query',
    ])
    expect(first.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'area', key: 'kr.seoul.seongsu', version: 3 }),
      expect.objectContaining({ kind: 'place-type', key: 'place.cafe', version: 4 }),
      expect.objectContaining({ kind: 'attribute', key: 'mood.quiet', version: 2 }),
      expect.objectContaining({ kind: 'query', normalizedQuery: '작업하기 좋은' }),
    ]))
  })

  it('removes an excluded stable token from the effective condition', () => {
    const initial = interpretCatalogSearch('성수 조용한 카페', [], areas, taxonomies)
    const areaToken = initial.tokens.find((token) => token.kind === 'area')!
    const withoutArea = interpretCatalogSearch(
      '성수 조용한 카페',
      [areaToken.tokenId],
      areas,
      taxonomies,
    )

    expect(withoutArea.tokens).not.toContainEqual(expect.objectContaining({ kind: 'area' }))
    expect(withoutArea.areaReference).toBeUndefined()
    expect(withoutArea.normalizedQuery).toBe('')
  })

  it('passes only exact interpreted references to the local catalog source', async () => {
    const observed: CatalogPlaceSearchQuery[] = []
    const search = createCatalogPlaceSearch({
      source: {
        searchCatalog: async (query) => {
          observed.push(query)
          return { items: [place] }
        },
      },
      vocabulary: {
        listAreas: async () => areas,
        listTaxonomies: async () => taxonomies,
      },
    })

    const page = await search({
      query: '성수 조용한 카페', excludedTokenIds: [], limit: 20,
    })

    expect(observed).toEqual([{
      query: '',
      areaReference: { key: 'kr.seoul.seongsu', version: 3 },
      areaReferences: [{ key: 'kr.seoul.seongsu', version: 3 }],
      taxonomyReferences: [
        { key: 'place.cafe', version: 4 },
        { key: 'mood.quiet', version: 2 },
      ],
      taxonomyReferenceGroups: [
        [{ key: 'place.cafe', version: 4, kind: 'category' }],
        [{ key: 'mood.quiet', version: 2, kind: 'attribute' }],
      ],
      limit: 20,
    }])
    expect(page.items).toEqual([place])
    expect(page.mapBounds).toEqual({
      west: 127.0555, south: 37.544, east: 127.0565, north: 37.545,
    })
    expect(JSON.stringify(page)).not.toMatch(/provider|rawPayload|saved|wanted/i)
  })

  it('expands selected parent Area and category filters to their current descendants', async () => {
    const observed: CatalogPlaceSearchQuery[] = []
    const search = createCatalogPlaceSearch({
      source: {
        searchCatalog: async (query) => {
          observed.push(query)
          return { items: [] }
        },
      },
      vocabulary: {
        listAreas: async () => [
          { key: 'kr.seoul', version: 2, parentKey: null, names: [{ languageTag: 'ko', name: '서울' }], defaultLanguageTag: 'ko' },
          ...areas,
        ],
        listTaxonomies: async () => [
          { key: 'place.food', version: 1, parentKey: null, label: '음식점', kind: 'category' },
          { key: 'place.food.ramen', version: 3, parentKey: 'place.food', label: '라멘', kind: 'category' },
        ],
      },
    })

    await search({ query: '서울 음식점', excludedTokenIds: [], limit: 20 })

    expect(observed[0]).toMatchObject({
      areaReferences: [
        { key: 'kr.seoul', version: 2 },
        { key: 'kr.seoul.seongsu', version: 3 },
      ],
      taxonomyReferenceGroups: [[
        { key: 'place.food', version: 1, kind: 'category' },
        { key: 'place.food.ramen', version: 3, kind: 'category' },
      ]],
    })
  })

  it('leaves an ambiguous vocabulary label as free text instead of guessing', () => {
    const interpreted = interpretCatalogSearch('중앙 카페', [], [
      ...areas,
      { ...areas[0]!, key: 'kr.seoul.central-a', names: [{ languageTag: 'ko', name: '중앙' }] },
      { ...areas[0]!, key: 'kr.seoul.central-b', names: [{ languageTag: 'ko', name: '중앙' }] },
    ], taxonomies)

    expect(interpreted.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'query', normalizedQuery: '중앙' }),
    ]))
    expect(interpreted.areaReference).toBeUndefined()
  })
})
