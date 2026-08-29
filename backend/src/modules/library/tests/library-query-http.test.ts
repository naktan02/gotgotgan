import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  InvalidLibraryCursorError,
  registerLibraryHttpRoutes,
  type LibraryQueries,
  type LibraryStore,
} from '../index.js'

const memberId = '01992d20-3000-7000-8000-000000000101'
const placeId = '01992d20-3000-7000-8000-000000000201'
const collectionId = '01992d20-3000-7000-8000-000000000301'
const at = '2026-08-28T00:00:00.000Z'

const store: LibraryStore = {
  apply: async () => ({ status: 'applied' }),
  getPlacePreferences: async () => undefined,
}

function fixture(overrides: Partial<LibraryQueries> = {}) {
  const queries: LibraryQueries = {
    getPublishedCollection: async () => undefined,
    listPlaces: async (input) => ({
      schemaVersion: 'library-place-list.v3',
      filter: {
        state: input.state, tagIds: input.tagIds, tagMatch: input.tagMatch,
        areaKeys: input.areaKeys, taxonomyKeys: input.taxonomyKeys,
      },
      items: [{
        placeId,
        saved: true,
        wanted: false,
        personalRating: 4.4,
        updatedAt: at,
        place: null,
      }],
    }),
    getPlaceFacets: async () => ({
      schemaVersion: 'library-place-facets.v1', sourceState: 'saved',
      coverage: { savedPlaceCount: 2, sampledPlaceCount: 2, projectedPlaceCount: 2, complete: true },
      areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '서울 성동구', count: 2 }],
      taxonomies: [{ key: 'food.noodle.ramen', label: '라멘', count: 1 }],
    }),
    listCollections: async () => ({
      schemaVersion: 'library-collection-list.v1',
      items: [{
        collectionId,
        name: '성수',
        description: null,
        visibility: 'private',
        publicationId: null,
        placeCount: 1,
        updatedAt: at,
      }],
    }),
    getCollection: async () => ({
      schemaVersion: 'library-collection-detail.v1',
      collection: {
        collectionId,
        name: '성수',
        description: null,
        visibility: 'private',
        publicationId: null,
        placeCount: 1,
        updatedAt: at,
      },
      places: [{ placeId, position: 0, addedAt: at, place: null }],
    }),
    listTags: async () => ({
      schemaVersion: 'library-tag-list.v1',
      items: [{
        tagId: '01992d20-3000-7000-8000-000000000401',
        name: '혼밥',
        placeCount: 1,
        createdAt: at,
      }],
    }),
    getPlaceOrganization: async (input) => ({
      schemaVersion: 'library-place-organization.v1',
      placeId: input.placeId,
      items: [{
        kind: 'collection',
        collectionId,
        name: '성수',
        selected: true,
        position: 0,
      }, {
        kind: 'tag',
        tagId: '01992d20-3000-7000-8000-000000000401',
        name: '혼밥',
        selected: false,
      }],
    }),
    ...overrides,
  }
  const app = Fastify({ logger: false })
  registerLibraryHttpRoutes(app, {
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId }
      : { status: 'authentication-required' },
    store,
    queries,
    now: () => new Date(at),
  })
  return { app, queries }
}

describe('bounded Library HTTP queries', () => {
  it('requires a member and applies saved/20 defaults', async () => {
    const listPlaces = vi.fn<LibraryQueries['listPlaces']>(async (input) => ({
      schemaVersion: 'library-place-list.v3',
      filter: {
        state: input.state, tagIds: input.tagIds, tagMatch: input.tagMatch,
        areaKeys: input.areaKeys, taxonomyKeys: input.taxonomyKeys,
      },
      items: [],
    }))
    const { app } = fixture({ listPlaces })

    expect((await app.inject({ method: 'GET', url: '/v1/library/places' })).statusCode).toBe(401)
    const response = await app.inject({
      method: 'GET', url: '/v1/library/places',
      headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(200)
    expect(listPlaces).toHaveBeenCalledWith({
      memberId, state: 'saved', tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 20,
    })
    await app.close()
  })

  it('publishes bounded Place, Collection, and Tag projections', async () => {
    const { app } = fixture()
    const headers = { authorization: 'Bearer good' }

    const places = await app.inject({
      method: 'GET', url: '/v1/library/places?state=rated&limit=10', headers,
    })
    expect(places.statusCode).toBe(200)
    expect(places.json()).toMatchObject({
      schemaVersion: 'library-place-list.v3',
      filter: { state: 'rated', tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
    })
    const facets = await app.inject({
      method: 'GET', url: '/v1/library/place-facets', headers,
    })
    expect(facets.json()).toMatchObject({
      schemaVersion: 'library-place-facets.v1',
      sourceState: 'saved',
      coverage: { savedPlaceCount: 2 },
    })
    expect((await app.inject({
      method: 'GET', url: '/v1/library/place-facets?memberId=private', headers,
    })).statusCode).toBe(400)
    const collections = await app.inject({
      method: 'GET', url: '/v1/library/collections', headers,
    })
    expect(collections.json()).toHaveProperty('items.0.placeCount', 1)
    const collection = await app.inject({
      method: 'GET', url: `/v1/library/collections/${collectionId}`, headers,
    })
    expect(collection.json()).toHaveProperty('places.0.position', 0)
    const tags = await app.inject({ method: 'GET', url: '/v1/library/tags', headers })
    expect(tags.json()).toHaveProperty('items.0.name', '혼밥')
    const organization = await app.inject({
      method: 'GET', url: `/v1/library/places/${placeId}/organization`, headers,
    })
    expect(organization.json()).toMatchObject({
      schemaVersion: 'library-place-organization.v1',
      placeId,
      items: [
        { kind: 'collection', collectionId, selected: true },
        { kind: 'tag', selected: false },
      ],
    })
    await app.close()
  })

  it('passes repeated Tag IDs and the match mode as a normalized filter', async () => {
    const firstTag = '01992d20-3000-7000-8000-000000000402'
    const secondTag = '01992d20-3000-7000-8000-000000000401'
    const listPlaces = vi.fn<LibraryQueries['listPlaces']>(async (input) => ({
      schemaVersion: 'library-place-list.v3',
      filter: {
        state: input.state, tagIds: input.tagIds, tagMatch: input.tagMatch,
        areaKeys: input.areaKeys, taxonomyKeys: input.taxonomyKeys,
      },
      items: [],
    }))
    const { app } = fixture({ listPlaces })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/library/places?tagIds=${firstTag}&tagIds=${secondTag}&tagMatch=any&areaKeys=area_abcdefghijklmnopqrstuv&taxonomyKeys=food.noodle.ramen`,
      headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(200)
    expect(listPlaces).toHaveBeenCalledWith({
      memberId,
      state: 'saved',
      tagIds: [secondTag, firstTag],
      tagMatch: 'any',
      areaKeys: ['area_abcdefghijklmnopqrstuv'],
      taxonomyKeys: ['food.noodle.ramen'],
      limit: 20,
    })
    await app.close()
  })

  it('rejects malformed and mismatched cursors and hides another member collection', async () => {
    const { app } = fixture({
      listPlaces: async () => { throw new InvalidLibraryCursorError() },
      getCollection: async () => undefined,
    })
    const headers = { authorization: 'Bearer good' }

    expect((await app.inject({
      method: 'GET', url: '/v1/library/places?limit=51', headers,
    })).statusCode).toBe(400)
    const cursor = await app.inject({
      method: 'GET', url: '/v1/library/places?cursor=opaque', headers,
    })
    expect(cursor.statusCode).toBe(400)
    expect(cursor.json()).toMatchObject({ code: 'PLACE_LIBRARY_CURSOR_INVALID' })
    expect((await app.inject({
      method: 'GET', url: `/v1/library/collections/${collectionId}`, headers,
    })).statusCode).toBe(404)
    await app.close()
  })

  it('validates and forwards a bounded selected Place organization query', async () => {
    const getPlaceOrganization = vi.fn<LibraryQueries['getPlaceOrganization']>(async (input) => ({
      schemaVersion: 'library-place-organization.v1',
      placeId: input.placeId,
      items: [],
    }))
    const { app } = fixture({ getPlaceOrganization })
    const headers = { authorization: 'Bearer good' }

    expect((await app.inject({
      method: 'GET',
      url: '/v1/library/places/not-a-place/organization',
      headers,
    })).statusCode).toBe(400)
    const response = await app.inject({
      method: 'GET',
      url: `/v1/library/places/${placeId}/organization?cursor=next-page&limit=12`,
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(getPlaceOrganization).toHaveBeenCalledWith({
      memberId, placeId, cursor: 'next-page', limit: 12,
    })
    await app.close()
  })
})
