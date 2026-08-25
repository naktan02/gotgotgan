import { afterEach, describe, expect, it } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const item = {
  placeId: '01992d20-0000-7000-8000-000000000101',
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
