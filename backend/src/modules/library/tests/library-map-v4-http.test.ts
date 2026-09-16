import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import type { PersonalLibraryMapV4 } from '../application/ports/personal-library-map-v4.js'
import { registerLibraryMapV4HttpRoutes } from '../transport/http/register-library-map-v4-http.js'

const memberId = '01992d20-3000-7000-8000-000000000101'
const collectionA = '01992d20-3000-7000-8000-000000000301'
const collectionB = '01992d20-3000-7000-8000-000000000302'

describe('Library map v4 HTTP', () => {
  it('accepts repeated owned Collection selection without exposing member identity', async () => {
    const openMapV4 = vi.fn<PersonalLibraryMapV4['openMapV4']>(async (query) => ({
      schemaVersion: 'personal-library-map.v4',
      selection: query.selection,
      filter: { ratingFilter: query.ratingFilter, tagIds: query.tagIds, tagMatch: query.tagMatch,
        areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys },
      selectedCollections: [
        { collectionId: collectionA, name: '성수', colorToken: 'fern' },
        { collectionId: collectionB, name: '을지로', colorToken: 'ocean' },
      ],
      viewport: { bounds: query.bounds, zoom: query.zoom },
      features: [],
      coverage: { representedPlaceCount: 0, unprojectedPlaceCount: 0, complete: true },
    }))
    const app = Fastify({ logger: false })
    registerLibraryMapV4HttpRoutes(app, {
      authorizer: async (authorization) => authorization === 'Bearer good'
        ? { status: 'authorized', memberId }
        : { status: 'authentication-required' },
      map: { openMapV4 },
    })
    const query = `scope=collections&collectionIds=${collectionA}&collectionIds=${collectionB}&west=126&south=37&east=128&north=38&zoom=14`
    expect((await app.inject({ method: 'GET', url: `/v4/library/workspace/map?${query}` })).statusCode).toBe(401)
    const response = await app.inject({ method: 'GET', url: `/v4/library/workspace/map?${query}`,
      headers: { authorization: 'Bearer good' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).not.toContain(memberId)
    expect(openMapV4).toHaveBeenCalledWith(expect.objectContaining({
      memberId,
      selection: { kind: 'collections', collectionIds: [collectionA, collectionB] },
    }), expect.any(AbortSignal))
    expect((await app.inject({ method: 'GET',
      url: `/v4/library/workspace/map?scope=all&collectionIds=${collectionA}&west=126&south=37&east=128&north=38&zoom=14`,
      headers: { authorization: 'Bearer good' } })).statusCode).toBe(400)
    await app.close()
  })
})
