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
    getPublishedCollectionMap: async () => undefined,
    getMapProjection: async (input) => ({
      schemaVersion: 'library-map-projection.v1',
      scope: input.scope,
      viewport: { bounds: input.bounds, zoom: input.zoom },
      features: [{
        kind: 'place', placeId, label: '성수 라멘',
        location: { latitude: 37.5445, longitude: 127.056 },
      }],
      coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
    }),
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
  it('paginates public rows separately from the viewport map', async () => {
    const publicationId = '01992d20-3000-7000-8000-000000000901'
    const getPublishedCollection = vi.fn<LibraryQueries['getPublishedCollection']>(async (input) => ({
      publicationId,
      visibility: 'unlisted',
      name: '공유 목록',
      description: null,
      placeCount: 120,
      places: [{ placeId, position: 0, place: null }],
      nextCursor: 'next-public-page',
      updatedAt: at,
    }))
    const getPublishedCollectionMap = vi.fn<LibraryQueries['getPublishedCollectionMap']>(async (input) => ({
      schemaVersion: 'place-published-collection-map.v1',
      publicationId,
      viewport: { bounds: input.bounds, zoom: input.zoom },
      features: [{
        kind: 'cluster', clusterId: 'z12-x1-y1', count: 120,
        location: { latitude: 37.55, longitude: 127 },
        bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      }],
      coverage: { representedPlaceCount: 120, unprojectedPlaceCount: 0, complete: true },
    }))
    const { app } = fixture({ getPublishedCollection, getPublishedCollectionMap })

    const page = await app.inject({
      method: 'GET', url: `/v1/public/collections/${publicationId}`,
    })
    expect(page.statusCode).toBe(200)
    expect(page.json()).toMatchObject({
      schemaVersion: 'place-published-collection.v3', placeCount: 120,
      nextCursor: 'next-public-page',
    })
    expect(getPublishedCollection).toHaveBeenCalledWith({ publicationId, limit: 50 })

    const map = await app.inject({
      method: 'GET',
      url: `/v1/public/collections/${publicationId}/map?west=126.9&south=37.5&east=127.1&north=37.6&zoom=12`,
    })
    expect(map.statusCode).toBe(200)
    expect(map.json()).toHaveProperty('coverage.representedPlaceCount', 120)
    expect(getPublishedCollectionMap).toHaveBeenCalledWith({
      publicationId,
      bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      zoom: 12,
    })
    expect((await app.inject({
      method: 'GET',
      url: `/v1/public/collections/${publicationId}/map?west=127.1&south=37.5&east=126.9&north=37.6&zoom=12`,
    })).statusCode).toBe(400)
    await app.close()
  })

  it('rejects stale public collection cursors without exposing publication state', async () => {
    const publicationId = '01992d20-3000-7000-8000-000000000901'
    const { app } = fixture({
      getPublishedCollection: async () => {
        throw new InvalidLibraryCursorError('changed publication')
      },
    })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/public/collections/${publicationId}?cursor=stale`,
    })
    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json())).not.toContain('changed publication')
    await app.close()
  })

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

  it('projects the complete viewport independently from list pagination', async () => {
    const getMapProjection = vi.fn<LibraryQueries['getMapProjection']>(async (input) => ({
      schemaVersion: 'library-map-projection.v1',
      scope: input.scope,
      viewport: { bounds: input.bounds, zoom: input.zoom },
      features: [{
        kind: 'cluster', clusterId: 'z12-x1-y1', count: 3,
        location: { latitude: 37.55, longitude: 126.93 },
        bounds: { west: 126.92, south: 37.54, east: 126.94, north: 37.56 },
      }],
      coverage: { representedPlaceCount: 3, unprojectedPlaceCount: 0, complete: true },
    }))
    const { app } = fixture({ getMapProjection })
    const tagId = '01992d20-3000-7000-8000-000000000401'
    const response = await app.inject({
      method: 'GET',
      url: `/v1/library/map?scope=state&state=saved&tagIds=${tagId}&tagMatch=any&west=126.9&south=37.5&east=127.1&north=37.6&zoom=12`,
      headers: { authorization: 'Bearer good' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      schemaVersion: 'library-map-projection.v1',
      coverage: { representedPlaceCount: 3 },
      features: [{ kind: 'cluster', count: 3 }],
    })
    expect(getMapProjection).toHaveBeenCalledWith({
      memberId,
      scope: {
        kind: 'state', state: 'saved', tagIds: [tagId], tagMatch: 'any',
        areaKeys: [], taxonomyKeys: [],
      },
      bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      zoom: 12,
    })
    await app.close()
  })

  it('rejects malformed map viewports and hides foreign Collections', async () => {
    const { app } = fixture({ getMapProjection: async () => undefined })
    const headers = { authorization: 'Bearer good' }

    expect((await app.inject({
      method: 'GET',
      url: '/v1/library/map?scope=state&west=127.1&south=37.5&east=126.9&north=37.6&zoom=12',
      headers,
    })).statusCode).toBe(400)
    expect((await app.inject({
      method: 'GET',
      url: `/v1/library/map?scope=collection&collectionId=${collectionId}&west=126.9&south=37.5&east=127.1&north=37.6&zoom=12`,
      headers,
    })).statusCode).toBe(404)
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
