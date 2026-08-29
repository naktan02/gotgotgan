import { describe, expect, it } from 'vitest'

import {
  LibraryPreferenceVersionConflictError,
  type LibraryQueries,
  type LibraryStore,
  type PublishedCollection,
} from '../../modules/library/index.js'
import type { VisitQueries, VisitRecord, VisitStore } from '../../modules/visits/index.js'
import type {
  PublishedWriting,
  WritingQueries,
  WritingStore,
} from '../../modules/writing/index.js'
import type { ProductAuthorizer } from '../../platform/http/product-authorization.js'
import { buildHttpApplication } from './app.js'

const memberId = '01992d04-0000-7000-8000-000000000001'
const placeId = '01992d04-0000-7000-8000-000000000002'
const publicationId = '01992d04-0000-7000-8000-000000000003'
const now = () => new Date('2026-08-26T10:00:00.000Z')
const authorizer: ProductAuthorizer = async (authorization) => authorization === 'Bearer good'
  ? { status: 'authorized' as const, memberId }
  : { status: 'authentication-required' as const }

function fixtureApplication(
  apply: LibraryStore['apply'] = async () => ({ status: 'applied' }),
  fixtureAuthorizer: ProductAuthorizer = authorizer,
) {
  const library: LibraryStore = {
    apply,
    getPlacePreferences: async () => ({ memberId, placeId, saved: true, wanted: false, personalRating: 4.4, updatedAt: now().toISOString() }),
  }
  const libraryQueries: LibraryQueries = {
    getPublishedCollection: async (input): Promise<PublishedCollection | undefined> => input.publicationId === publicationId ? {
      publicationId,
      visibility: 'unlisted',
      name: 'Shared places',
      description: null,
      placeCount: 1,
      places: [{
        placeId,
        position: 0,
        place: {
          placeId,
          name: '조용한 라멘 연구소',
          areaLabel: '서울 성동구 성수동',
          location: { latitude: 37.5445, longitude: 127.056 },
          primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
          taxonomyKeys: ['food.noodle.ramen'],
          evidence: { status: 'verified', projectedAt: now().toISOString() },
        },
      }],
      updatedAt: now().toISOString(),
    } : undefined,
    getPublishedCollectionMap: async (input) => input.publicationId === publicationId ? {
      schemaVersion: 'place-published-collection-map.v1',
      publicationId,
      viewport: { bounds: input.bounds, zoom: input.zoom },
      features: [{
        kind: 'place', placeId, label: '조용한 라멘 연구소',
        location: { latitude: 37.5445, longitude: 127.056 },
      }],
      coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
    } : undefined,
    getMapProjection: async (input) => ({
      schemaVersion: 'library-map-projection.v1',
      scope: input.scope,
      viewport: { bounds: input.bounds, zoom: input.zoom },
      features: [],
      coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
    }),
    listPlaces: async (input) => ({
      schemaVersion: 'library-place-list.v3',
      filter: {
        state: input.state, tagIds: input.tagIds, tagMatch: input.tagMatch,
        areaKeys: input.areaKeys, taxonomyKeys: input.taxonomyKeys,
      },
      items: [],
    }),
    getPlaceFacets: async () => ({
      schemaVersion: 'library-place-facets.v1', sourceState: 'saved',
      coverage: { savedPlaceCount: 0, sampledPlaceCount: 0, projectedPlaceCount: 0, complete: true },
      areas: [], taxonomies: [],
    }),
    listCollections: async () => ({ schemaVersion: 'library-collection-list.v1', items: [] }),
    getCollection: async () => undefined,
    listTags: async () => ({ schemaVersion: 'library-tag-list.v1', items: [] }),
    getPlaceOrganization: async (input) => ({
      schemaVersion: 'library-place-organization.v1', placeId: input.placeId, items: [],
    }),
  }
  const visits: VisitStore = {
    append: async (_record: VisitRecord) => 'recorded',
    summarize: async () => ({ visited: true, count: 2, firstVisitedAt: '2026-07-01T12:00:00.000Z', lastVisitedAt: '2026-08-01T12:00:00.000Z' }),
  }
  const visitQueries: VisitQueries = {
    listPlaceVisits: async (input) => ({
      schemaVersion: 'visit-history.v1',
      placeId: input.placeId,
      items: [],
    }),
  }
  const writing: WritingStore = {
    apply: async (attempt) => ({ status: 'applied', documentId: attempt.command.documentId, version: 1 }),
    getPublished: async (id): Promise<PublishedWriting | undefined> => id === publicationId ? {
      kind: 'note',
      publicationId,
      visibility: 'public',
      body: '공개 메모',
      placeIds: [placeId],
      updatedAt: now().toISOString(),
    } : undefined,
  }
  const writingQueries: WritingQueries = {
    list: async (input) => ({
      schemaVersion: 'writing-list.v2',
      filter: { kind: input.kind },
      items: [],
    }),
    get: async () => undefined,
  }
  return buildHttpApplication({
    library: { authorizer: fixtureAuthorizer, store: library, queries: libraryQueries, now },
    visits: { authorizer: fixtureAuthorizer, store: visits, queries: visitQueries, now },
    writing: { authorizer: fixtureAuthorizer, store: writing, queries: writingQueries, now },
  })
}

describe('Stage 4 product HTTP boundary', () => {
  it('takes member identity only from authorization', async () => {
    const application = fixtureApplication()
    const denied = await application.inject({ method: 'GET', url: `/v1/library/places/${placeId}` })
    expect(denied.statusCode).toBe(401)
    const allowed = await application.inject({ method: 'GET', url: `/v1/library/places/${placeId}`, headers: { authorization: 'Bearer good' } })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json()).toMatchObject({
      schemaVersion: 'library-place-preferences.v1', personalRating: 4.4,
    })
    expect(allowed.json()).not.toHaveProperty('memberId')
    await application.close()
  })

  it('keeps owner library, writing, and visit occurrence reads authenticated', async () => {
    const application = fixtureApplication()
    for (const url of [
      `/v1/library/places/${placeId}`,
      '/v1/writing',
      `/v1/places/${placeId}/visits`,
    ]) {
      expect((await application.inject({ method: 'GET', url })).statusCode).toBe(401)
      expect((await application.inject({ method: 'GET', url, headers: { authorization: 'Bearer good' } })).statusCode).toBe(200)
    }
    await application.close()
  })

  it('rejects actor and role fields on mutation commands', async () => {
    const application = fixtureApplication()
    const response = await application.inject({
      method: 'POST',
      url: '/v1/library/commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        commandId: '01992d04-0000-7000-8000-000000000010',
        memberId,
        role: 'owner',
        command: {
          kind: 'set-place-preferences', placeId, expectedUpdatedAt: now().toISOString(),
          saved: true, wanted: false, personalRating: 4.4,
        },
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'PLACE_LIBRARY_COMMAND_INVALID' })
    await application.close()
  })

  it('reports a stale preference version as a retryable conflict', async () => {
    const application = fixtureApplication(async () => {
      throw new LibraryPreferenceVersionConflictError('stale preference version')
    })
    const response = await application.inject({
      method: 'POST',
      url: '/v1/library/commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        commandId: '01992d04-0000-7000-8000-000000000011',
        command: {
          kind: 'set-place-preferences', placeId, expectedUpdatedAt: now().toISOString(),
          saved: false, wanted: true, personalRating: null,
        },
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      code: 'PLACE_LIBRARY_PREFERENCE_VERSION_CONFLICT',
      retryable: true,
    })
    await application.close()
  })

  it('routes Collection publication through the dedicated product permission seam', async () => {
    const permissions: string[] = []
    const application = fixtureApplication(async () => ({ status: 'applied' }), async (
      authorization,
      permission,
    ) => {
      permissions.push(permission)
      return authorization === 'Bearer good'
        ? { status: 'authorized', memberId }
        : { status: 'authentication-required' }
    })
    const response = await application.inject({
      method: 'POST',
      url: '/v1/library/commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        commandId: '01992d04-0000-7000-8000-000000000012',
        command: {
          kind: 'set-collection-publication',
          collectionId: '01992d04-0000-7000-8000-000000000013',
          expectedUpdatedAt: now().toISOString(),
          visibility: 'unlisted',
        },
      },
    })
    expect(response.statusCode).toBe(201)
    expect(permissions).toEqual(['library.share'])
    await application.close()
  })

  it('exposes allowlisted public projections and hides unknown/private identifiers', async () => {
    const application = fixtureApplication()
    const collection = await application.inject({ method: 'GET', url: `/v1/public/collections/${publicationId}` })
    expect(collection.statusCode).toBe(200)
    expect(collection.headers['cache-control']).toBe('no-store')
    expect(collection.json()).toEqual({
      schemaVersion: 'place-published-collection.v3',
      publicationId,
      visibility: 'unlisted',
      name: 'Shared places',
      description: null,
      placeCount: 1,
      places: [{
        placeId,
        position: 0,
        place: {
          placeId,
          name: '조용한 라멘 연구소',
          areaLabel: '서울 성동구 성수동',
          location: { latitude: 37.5445, longitude: 127.056 },
          primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
          taxonomyKeys: ['food.noodle.ramen'],
          evidence: { status: 'verified', projectedAt: now().toISOString() },
        },
      }],
      updatedAt: now().toISOString(),
    })
    const map = await application.inject({
      method: 'GET',
      url: `/v1/public/collections/${publicationId}/map?west=126.9&south=37.5&east=127.1&north=37.6&zoom=12`,
    })
    expect(map.statusCode).toBe(200)
    expect(map.json()).toMatchObject({
      schemaVersion: 'place-published-collection-map.v1',
      publicationId,
      coverage: { representedPlaceCount: 1, complete: true },
    })
    const absent = await application.inject({ method: 'GET', url: '/v1/public/collections/01992d04-0000-7000-8000-000000000099' })
    expect(absent.statusCode).toBe(404)
    expect(absent.json()).not.toHaveProperty('memberId')
    const writing = await application.inject({ method: 'GET', url: `/v1/public/writing/${publicationId}` })
    expect(writing.json()).toMatchObject({ schemaVersion: 'place-published-writing.v1' })
    expect(writing.headers['cache-control']).toBe('no-store')
    expect(writing.json()).not.toHaveProperty('memberId')
    await application.close()
  })

  it('records repeat visits and returns a derived summary', async () => {
    const application = fixtureApplication()
    const recorded = await application.inject({
      method: 'POST',
      url: '/v1/visits',
      headers: { authorization: 'Bearer good' },
      payload: { id: '01992d04-0000-7000-8000-000000000020', placeId, visitedAt: '2026-08-01T12:00:00.000Z' },
    })
    expect(recorded.statusCode).toBe(201)
    const summary = await application.inject({ method: 'GET', url: `/v1/places/${placeId}/visit-summary`, headers: { authorization: 'Bearer good' } })
    expect(summary.json()).toMatchObject({
      schemaVersion: 'visit-summary.v1', placeId, visited: true, count: 2,
    })
    await application.close()
  })
})
