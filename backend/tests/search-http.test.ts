import { afterEach, describe, expect, it } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const item = {
  resultId: 'place:01992d20-0000-7000-8000-000000000101',
  identity: {
    kind: 'canonical' as const,
    placeId: '01992d20-0000-7000-8000-000000000101',
  },
  source: {
    key: 'local', label: '내 장소', detailsAvailable: false, attributions: [],
  },
  freshness: { kind: 'indexed' as const, observedAt: '2026-08-26T10:00:00.000Z' },
  name: '조용한 라멘 연구소',
  areaLabel: '성수',
  location: { latitude: 37.5445, longitude: 127.056 },
  primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
  taxonomyKeys: ['food.noodle.ramen'],
  evidenceStatus: 'verified' as const,
}

const applications: ReturnType<typeof buildHttpApplication>[] = []
afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()))
})

describe('search HTTP interface', () => {
  it('serves a bounded antimeridian-aware catalog map projection', async () => {
    const observed: unknown[] = []
    const application = buildHttpApplication({
      search: {
        search: async () => ({
          schemaVersion: 'place-search.v1', items: [],
          sources: [{ sourceKey: 'local', status: 'complete', resultCount: 0 }],
        }),
        catalogMap: async (query) => {
          observed.push(query)
          return {
            schemaVersion: 'catalog-place-map.v1',
            interpretation: { normalizedQuery: '', tokens: [] },
            viewport: query.viewport,
            zoom: query.zoom,
            mode: 'clusters',
            features: [{
              kind: 'cluster', featureId: 'cluster:4:0:0',
              location: { latitude: 0, longitude: 179 }, bounds: query.viewport,
              placeCount: 8,
            }],
            coverage: {
              matchingPlaceCount: 8, representedPlaceCount: 8, complete: true,
            },
          }
        },
      },
    })
    applications.push(application)

    const response = await application.inject({
      method: 'POST', path: '/v1/search/catalog/map',
      payload: {
        schemaVersion: 'catalog-place-map.v1', query: '관광지',
        viewport: { west: 170, south: -20, east: -170, north: 20 }, zoom: 4,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(observed).toEqual([expect.objectContaining({ maxFeatures: 384, zoom: 4 })])
    expect(response.json()).toMatchObject({
      schemaVersion: 'catalog-place-map.v1', mode: 'clusters',
      coverage: { matchingPlaceCount: 8, complete: true },
    })
    const invalid = await application.inject({
      method: 'POST', path: '/v1/search/catalog/map',
      payload: {
        schemaVersion: 'catalog-place-map.v1', query: '',
        viewport: { west: 0, south: -90, east: 10, north: 20 }, zoom: 4,
      },
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('serves a canonical-only interpreted catalog projection for Home', async () => {
    const observed: unknown[] = []
    const application = buildHttpApplication({
      search: {
        search: async () => ({
          schemaVersion: 'place-search.v1', items: [],
          sources: [{ sourceKey: 'local', status: 'complete', resultCount: 0 }],
        }),
        catalog: async (query) => {
          observed.push(query)
          return {
            schemaVersion: 'catalog-place-search.v1',
            interpretation: {
              normalizedQuery: '',
              tokens: [{
                tokenId: 'place-type:Zm9vZC5ub29kbGUucmFtZW4:4',
                kind: 'place-type', key: 'food.noodle.ramen', version: 4, label: '라멘',
              }],
            },
            items: [{
              placeId: '01992d20-0000-7000-8000-000000000101',
              name: '조용한 라멘 연구소',
              area: { label: '성수', reference: { key: 'kr.seoul.seongsu', version: 3 } },
              location: { latitude: 37.5445, longitude: 127.056 },
              primaryTaxonomy: { key: 'food.noodle.ramen', version: 4, label: '라멘' },
              taxonomyReferences: [{ key: 'food.noodle.ramen', version: 4, kind: 'category' }],
              evidenceStatus: 'verified',
              projectedAt: '2026-08-26T10:00:00.000Z',
            }],
            mapBounds: { west: 127.0555, south: 37.544, east: 127.0565, north: 37.545 },
          }
        },
      },
    })
    applications.push(application)

    const response = await application.inject({
      method: 'POST', path: '/v1/search/catalog',
      payload: {
        schemaVersion: 'catalog-place-search.v1', query: '성수 라멘',
        excludedTokenIds: ['attribute:bW9vZC5xdWlldA:2'],
        bounds: { west: 170, south: -20, east: -170, north: 20 },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(observed).toEqual([{
      query: '성수 라멘', excludedTokenIds: ['attribute:bW9vZC5xdWlldA:2'], limit: 20,
      bounds: { west: 170, south: -20, east: -170, north: 20 },
    }])
    expect(response.json()).toMatchObject({
      schemaVersion: 'catalog-place-search.v1',
      items: [{ placeId: '01992d20-0000-7000-8000-000000000101' }],
    })
    expect(JSON.stringify(response.json())).not.toMatch(/providerPlaceId|rawPayload|saved|wanted/i)
  })

  it('serves anonymous public results and the data-defined taxonomy', async () => {
    const application = buildHttpApplication({
      search: {
        search: async () => ({
          schemaVersion: 'place-search.v1',
          items: [item],
          sources: [{ sourceKey: 'local', status: 'complete', resultCount: 1 }],
        }),
      },
      taxonomy: {
        store: {
          publish: async () => 'published',
          listCurrent: async () => [{
            key: 'food.noodle.ramen', parentKey: null, label: '라멘',
            kind: 'category', version: 1, active: true,
            effectiveAt: '2026-08-26T00:00:00.000Z',
          }],
        },
      },
    })
    applications.push(application)

    const search = await application.inject({
      method: 'POST', path: '/v1/search/places',
      payload: { schemaVersion: 'place-search.v1', query: '라멘' },
    })
    const taxonomy = await application.inject({ method: 'GET', path: '/v1/taxonomy/nodes' })

    expect(search.statusCode).toBe(200)
    expect(search.json()).toMatchObject({ items: [{ name: item.name }] })
    expect(taxonomy.json()).toEqual({
      schemaVersion: 'place-taxonomy.v1',
      nodes: [{ key: 'food.noodle.ramen', parentKey: null, label: '라멘', kind: 'category', version: 1 }],
    })
  })

  it('does not accept personal filters or invalid bearer evidence as anonymous search', async () => {
    const application = buildHttpApplication({
      search: {
        authorizer: async () => ({ status: 'authentication-required' }),
        search: async () => ({ schemaVersion: 'place-search.v1', items: [], sources: [{ sourceKey: 'local', status: 'complete', resultCount: 0 }] }),
      },
    })
    applications.push(application)

    const personal = await application.inject({
      method: 'POST', path: '/v1/search/places',
      payload: { schemaVersion: 'place-search.v1', query: '', filters: { saved: true } },
    })
    const invalidBearer = await application.inject({
      method: 'POST', path: '/v1/search/places', headers: { authorization: 'Bearer invalid' },
      payload: { schemaVersion: 'place-search.v1', query: '' },
    })

    expect(personal.statusCode).toBe(401)
    expect(invalidBearer.statusCode).toBe(401)
    expect(invalidBearer.json()).not.toHaveProperty('memberId')
  })
})
