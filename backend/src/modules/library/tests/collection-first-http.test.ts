import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  asOpaqueVersion,
  registerCollectionFirstHttpRoutes,
  type CollectionFirstHttpDependencies,
} from '../index.js'

const memberId = '01992d20-3000-7000-8000-000000000101'
const placeId = '01992d20-3000-7000-8000-000000000201'
const collectionId = '01992d20-3000-7000-8000-000000000301'
const secondCollectionId = '01992d20-3000-7000-8000-000000000302'
const commandId = '01992d20-3000-7000-8000-000000000401'
const revision = asOpaqueVersion('opaque-collection-revision')
const at = '2026-09-03T00:00:00.000Z'

function dependencies(
  overrides: Partial<CollectionFirstHttpDependencies> = {},
): CollectionFirstHttpDependencies {
  return {
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId }
      : { status: 'authentication-required' },
    workspace: {
      openMap: async () => undefined,
      open: async (query) => ({
        schemaVersion: 'personal-library-workspace.v2',
        filter: {
          favoriteScope: query.favoriteScope,
          ratingFilter: query.ratingFilter,
          tagIds: query.tagIds,
          tagMatch: query.tagMatch,
          areaKeys: query.areaKeys,
          taxonomyKeys: query.taxonomyKeys,
        },
        collections: {
          items: [{
            collectionId, name: '서울 라멘', description: null,
            visibility: 'private', publicationId: null, placeCount: 1,
            version: revision, updatedAt: at,
          }],
        },
        favoritePlaces: {
          items: [{
            placeId, collectionMembershipCount: 1, tagIds: [], personalRating: null,
            place: {
              placeId, name: '좌표 확인 중인 라멘집', areaLabel: '서울', location: null,
              primaryTaxonomy: { key: 'food.ramen', label: '라멘' },
              taxonomyKeys: ['food.ramen'],
              evidence: { status: 'unverified', projectedAt: at },
            },
          }],
        },
        availableFilters: {
          coverage: {
            favoritePlaceCount: 1, sampledPlaceCount: 1,
            projectedPlaceCount: 1, complete: true,
          },
          areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '서울', count: 1 }],
          taxonomies: [{ key: 'food.ramen', label: '라멘', count: 1 }],
        },
      }),
    },
    filing: {
      open: async () => ({
        schemaVersion: 'place-filing.v2', placeId,
        collectionMembershipCount: 1, personalRating: null,
        collections: [{
          collectionId, name: '서울 라멘', included: true, version: revision,
        }],
      }),
      apply: async (input) => ({
        status: 'applied', operationId: input.context.operationId,
        value: {
          placeId: input.placeId, collectionMembershipCount: 2, personalRating: null,
          collections: input.changes.map((change) => ({
            collectionId: change.collectionId,
            included: change.desired === 'included', version: revision,
          })),
        },
      }),
    },
    order: {
      move: async (input) => ({
        status: 'replayed', operationId: input.context.operationId,
        value: {
          collectionId: input.collectionId, placeId: input.placeId, version: revision,
        },
      }),
    },
    lifecycle: {
      apply: async (input) => ({
        status: 'applied', operationId: input.context.operationId,
        value: input.kind === 'delete'
          ? { collection: null }
          : {
              collection: {
                collectionId: input.collectionId,
                name: input.kind === 'create' ? input.name : input.name ?? '서울 라멘',
                description: input.kind === 'create' ? input.description : null,
                visibility: input.kind === 'update' ? input.visibility ?? 'private' : 'private',
                publicationId: null,
                placeCount: 0,
                version: revision,
                updatedAt: at,
              },
            },
      }),
    },
    now: () => new Date(at),
    ...overrides,
  }
}

function fixture(overrides: Partial<CollectionFirstHttpDependencies> = {}) {
  const app = Fastify({ logger: false })
  const configured = dependencies(overrides)
  registerCollectionFirstHttpRoutes(app, configured)
  return { app, configured }
}

describe('Collection-first Library HTTP', () => {
  it('passes independent text queries without accepting a browser member identity', async () => {
    const open = vi.fn(dependencies().workspace.open)
    const { app } = fixture({ workspace: { ...dependencies().workspace, open } })
    const response = await app.inject({
      method: 'GET', url: '/v1/library/workspace?collectionQuery=%EC%97%AC%ED%96%89&placeQuery=%EC%84%B1%EC%88%98%EB%8F%99%20%EB%9D%BC%EB%A9%98',
      headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(200)
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ memberId, collectionQuery: '여행', placeQuery: '성수동 라멘' }))
    const invalid = await app.inject({ method: 'GET', url: `/v1/library/workspace?memberId=${memberId}`, headers: { authorization: 'Bearer good' } })
    expect(invalid.statusCode).toBe(400)
  })

  it('authorizes the new map and passes the same Collection-first filters with a cancellation signal', async () => {
    const openMap = vi.fn<CollectionFirstHttpDependencies['workspace']['openMap']>(async (query) => ({
      schemaVersion: 'personal-library-map.v2',
      filter: { favoriteScope: query.favoriteScope, ratingFilter: query.ratingFilter,
        tagIds: query.tagIds, tagMatch: query.tagMatch, areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys,
        ...(query.placeQuery === undefined ? {} : { placeQuery: query.placeQuery }),
      },
      viewport: { bounds: query.bounds, zoom: query.zoom }, features: [],
      coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
    }))
    const { app } = fixture({ workspace: { ...dependencies().workspace, openMap } })
    const url = `/v2/library/workspace/map?collectionId=${collectionId}&placeQuery=ramen&rating=rated&taxonomyKeys=food.ramen&west=-180&south=-85&east=180&north=85&zoom=1`
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(openMap).not.toHaveBeenCalled()
    const response = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(openMap).toHaveBeenCalledWith(expect.objectContaining({ memberId,
      favoriteScope: { kind: 'collection', collectionId }, placeQuery: 'ramen',
      ratingFilter: { kind: 'rated' }, taxonomyKeys: ['food.ramen'],
    }), expect.any(AbortSignal))
    expect(response.body).not.toContain(memberId)
    expect((await app.inject({ method: 'GET', url: `${url}&memberId=${memberId}`, headers: { authorization: 'Bearer good' } })).statusCode).toBe(400)
  })

  it('returns only Collection-backed favorites and preserves unlocated Place summaries', async () => {
    const open = vi.fn<CollectionFirstHttpDependencies['workspace']['open']>(
      dependencies().workspace.open,
    )
    const { app } = fixture({ workspace: { ...dependencies().workspace, open } })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/library/workspace?collectionId=${collectionId}&rating=unrated&limit=10`,
      headers: { authorization: 'Bearer good' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'collection', collectionId },
        ratingFilter: { kind: 'unrated' },
      },
      places: [{
        placeId,
        overlay: { isFavorited: true, collectionCount: 1 },
        place: { location: null },
      }],
      availableFilters: {
        coverage: { favoritePlaceCount: 1 },
        areas: [{ label: '서울', count: 1 }],
      },
    })
    expect(response.body).not.toContain('saved')
    expect(response.body).not.toContain('wanted')
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ memberId, limit: 10 }))
  })

  it('does not disclose whether an unavailable scoped Collection belongs to another member', async () => {
    const { app } = fixture({ workspace: { ...dependencies().workspace, open: async () => undefined } })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/library/workspace?collectionId=${collectionId}`,
      headers: { authorization: 'Bearer good' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).not.toHaveProperty('collectionId')
  })

  it('applies one multi-Collection filing command and returns its updated overlay', async () => {
    const apply = vi.fn<CollectionFirstHttpDependencies['filing']['apply']>(
      dependencies().filing.apply,
    )
    const { app } = fixture({ filing: { ...dependencies().filing, apply } })
    const response = await app.inject({
      method: 'POST', url: '/v1/library/filing-commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'place-filing-command.v2', commandId, placeId,
        changes: [{
          collectionId, expectedCollectionRevision: revision, desired: 'included',
        }, {
          collectionId: secondCollectionId,
          expectedCollectionRevision: revision,
          desired: 'included',
        }],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      outcome: 'accepted', receipt: { commandId, status: 'applied' },
      overlay: { isFavorited: true, collectionCount: 2 },
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[0]).toMatchObject({
      context: { operationId: commandId, memberId, occurredAt: at },
      changes: [{ collectionId }, { collectionId: secondCollectionId }],
    })
  })

  it('keeps replay and lifecycle revision semantics on the v2 surface', async () => {
    const { app } = fixture()
    const ordered = await app.inject({
      method: 'POST', url: '/v1/library/order-commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'collection-order-command.v2', commandId,
        collectionId, placeId, expectedCollectionRevision: revision,
        anchor: { kind: 'first' },
      },
    })
    expect(ordered.statusCode).toBe(200)
    expect(ordered.json()).toMatchObject({
      outcome: 'accepted', receipt: { status: 'replayed' },
      collectionRevision: revision,
    })

    const created = await app.inject({
      method: 'POST', url: '/v1/library/collection-commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'collection-lifecycle-command.v2', kind: 'create',
        commandId, collectionId, name: '서울 라멘',
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      outcome: 'accepted', collection: { collectionId, collectionRevision: revision },
    })
  })
})
