import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import { asOpaqueVersion } from '../application/validate-collection-first.js'
import type { PublishedCollectionExchange } from '../application/ports/collection-first.js'
import type { PublicCollectionDiscovery } from '../application/ports/public-collection-discovery.js'
import type { ProductAuthorizer } from '../../../platform/http/product-authorization.js'
import { registerPublicCollectionHttpRoutes } from '../transport/http/register-public-collection-http.js'

const memberId = '01992d30-0000-7000-8000-000000000001'
const publicationId = '01992d30-0000-7000-8000-000000000002'
const collectionId = '01992d30-0000-7000-8000-000000000003'
const placeId = '01992d30-0000-7000-8000-000000000004'
const commandId = '01992d30-0000-7000-8000-000000000005'
const publicationVersion = asOpaqueVersion('collection-revision.v1.public')
const collectionRevision = asOpaqueVersion('collection-revision.v1.copy')

const authorizer: ProductAuthorizer = async (authorization) => authorization === 'Bearer good'
  ? { status: 'authorized', memberId }
  : { status: 'authentication-required' }

function fixture(input: Readonly<{
  discovery?: PublicCollectionDiscovery
  exchange?: PublishedCollectionExchange
}> = {}) {
  const item = {
    publicationId,
    publicationVersion,
    name: '도쿄 실내 가족 코스',
    description: '비 오는 날의 여섯 장소',
    placeCount: 1,
    updatedAt: '2026-09-03T00:00:00.000Z',
    owner: { handle: 'tokyo-parent', displayName: '도쿄새댁' },
    topics: [{ key: 'family-trip', label: '아이와 함께' }],
    previewPlaces: [{
      placeId,
      position: 0,
      place: {
        placeId,
        name: 'teamLab Planets TOKYO',
        areaLabel: '도쿄 도요스',
        location: { latitude: 35.6491, longitude: 139.7898 },
        primaryTaxonomy: { key: 'tourism.museum', label: '관광지' },
        taxonomyKeys: ['tourism.museum'],
        evidence: { status: 'verified' as const, projectedAt: '2026-09-03T00:00:00.000Z' },
      },
    }],
  }
  const discovery: PublicCollectionDiscovery = input.discovery ?? {
    list: async (query) => ({
      filter: {
        q: query.q, areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys,
        topicKeys: query.topicKeys, sort: query.sort,
      },
      items: [item],
      availableFilters: {
        areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '도쿄', count: 1 }],
        taxonomies: [{ key: 'tourism.museum', label: '관광지', count: 1 }],
        topics: [{ key: 'family-trip', label: '아이와 함께', count: 1 }],
      },
    }),
    get: async (query) => query.publicationId === publicationId
      ? {
          publicationId: item.publicationId,
          publicationVersion: item.publicationVersion,
          name: item.name,
          description: item.description,
          placeCount: item.placeCount,
          updatedAt: item.updatedAt,
          owner: item.owner,
          topics: item.topics,
          places: item.previewPlaces,
        }
      : undefined,
  }
  const exchange: PublishedCollectionExchange = input.exchange ?? {
    setPublication: async (command) => ({
      status: 'applied', operationId: command.context.operationId,
      value: {
        collectionId: command.collectionId, publicationId, visibility: command.visibility,
        version: collectionRevision,
      },
    }),
    copy: async (command) => ({
      status: 'applied', operationId: command.context.operationId,
      value: { collectionId: command.targetCollectionId, version: collectionRevision, copiedPlaceCount: 1 },
    }),
  }
  const app = Fastify()
  registerPublicCollectionHttpRoutes(app, {
    authorizer, discovery, exchange, now: () => new Date('2026-09-03T00:00:00.000Z'),
  })
  return { app, discovery, exchange }
}

describe('public Collection discovery HTTP', () => {
  it('publishes bounded discovery cards and moderation-safe detail projections', async () => {
    const list = vi.fn<PublicCollectionDiscovery['list']>(fixture().discovery.list)
    const { app } = fixture({ discovery: { list, get: fixture().discovery.get } })
    const directory = await app.inject({
      method: 'GET',
      url: '/v1/public/collection-directory?q=%EB%8F%84%EC%BF%84&topicKeys=family-trip&sort=largest&limit=6',
    })
    expect(directory.statusCode).toBe(200)
    expect(directory.json()).toMatchObject({
      schemaVersion: 'public-collection-directory.v2',
      items: [{ publicationId, publicationVersion, owner: { handle: 'tokyo-parent' } }],
    })
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      q: '도쿄', topicKeys: ['family-trip'], sort: 'largest', limit: 6,
    }))

    const detail = await app.inject({
      method: 'GET', url: `/v1/public/discoverable-collections/${publicationId}`,
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({
      schemaVersion: 'discoverable-collection.v2', publicationId, publicationVersion,
      places: [{ placeId }],
    })
    expect(detail.json()).not.toHaveProperty('personalRating')

    const absent = await app.inject({
      method: 'GET',
      url: '/v1/public/discoverable-collections/01992d30-0000-7000-8000-000000000099',
    })
    expect(absent.statusCode).toBe(404)
    await app.close()
  })

  it('passes an idempotent version-bound whole or partial copy to the deep exchange port', async () => {
    const copy = vi.fn<PublishedCollectionExchange['copy']>(async (command) => ({
      status: 'applied', operationId: command.context.operationId,
      value: { collectionId: command.targetCollectionId, version: collectionRevision, copiedPlaceCount: 1 },
    }))
    const base = fixture()
    const { app } = fixture({ exchange: { setPublication: base.exchange.setPublication, copy } })
    const response = await app.inject({
      method: 'POST', url: '/v1/library/publication-copy-commands',
      headers: { authorization: 'Bearer good' },
      payload: {
        schemaVersion: 'published-collection-copy-command.v2',
        commandId,
        sourcePublicationId: publicationId,
        expectedPublicationVersion: publicationVersion,
        target: { collectionId, name: '내 도쿄 코스' },
        selection: { kind: 'places', placeIds: [placeId] },
      },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      schemaVersion: 'published-collection-copy-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId, status: 'applied' },
      collectionId,
      collectionRevision,
      copiedPlaceCount: 1,
    })
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({
      publicationId,
      expectedPublicationVersion: publicationVersion,
      targetCollectionId: collectionId,
      targetName: '내 도쿄 코스',
      selection: { kind: 'places', placeIds: [placeId] },
      context: expect.objectContaining({ operationId: commandId, memberId }),
    }))
    await app.close()
  })
})
