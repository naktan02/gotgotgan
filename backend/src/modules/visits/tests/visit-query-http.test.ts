import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  InvalidVisitCursorError,
  registerVisitsHttpRoutes,
  type VisitQueries,
  type VisitStore,
} from '../index.js'

const memberId = '01992d21-0000-7000-8000-000000000101'
const placeId = '01992d21-0000-7000-8000-000000000201'
const visitId = '01992d21-0000-7000-8000-000000000301'
const at = '2026-08-28T00:00:00.000Z'

const store: VisitStore = {
  append: async () => 'recorded',
  summarize: async () => ({ visited: false, count: 0 }),
}

function fixture(overrides: Partial<VisitQueries> = {}) {
  const queries: VisitQueries = {
    listPlaceVisits: async (input) => ({
      schemaVersion: 'visit-history.v1',
      placeId: input.placeId,
      items: [{ visitId, visitedAt: at, recordedAt: at }],
    }),
    ...overrides,
  }
  const app = Fastify({ logger: false })
  registerVisitsHttpRoutes(app, {
    authorizer: async (authorization) => authorization === 'Bearer good'
      ? { status: 'authorized', memberId }
      : { status: 'authentication-required' },
    store,
    queries,
    now: () => new Date(at),
  })
  return app
}

describe('bounded Visit history HTTP query', () => {
  it('requires a member and applies the default limit', async () => {
    const listPlaceVisits = vi.fn<VisitQueries['listPlaceVisits']>(async (input) => ({
      schemaVersion: 'visit-history.v1', placeId: input.placeId, items: [],
    }))
    const app = fixture({ listPlaceVisits })

    expect((await app.inject({
      method: 'GET', url: `/v1/places/${placeId}/visits`,
    })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET', url: `/v1/places/${placeId}/visits`,
      headers: { authorization: 'Bearer good' },
    })).statusCode).toBe(200)
    expect(listPlaceVisits).toHaveBeenCalledWith({ memberId, placeId, limit: 20 })
    await app.close()
  })

  it('returns only the authored owner projection', async () => {
    const app = fixture()
    const response = await app.inject({
      method: 'GET', url: `/v1/places/${placeId}/visits?limit=1`,
      headers: { authorization: 'Bearer good' },
    })
    expect(response.json()).toEqual({
      schemaVersion: 'visit-history.v1',
      placeId,
      items: [{ visitId, visitedAt: at, recordedAt: at }],
    })
    expect(response.json().items[0]).not.toHaveProperty('fingerprint')
    expect(response.json().items[0]).not.toHaveProperty('memberId')
    await app.close()
  })

  it('rejects invalid limits and cursor failures', async () => {
    const app = fixture({
      listPlaceVisits: async () => { throw new InvalidVisitCursorError() },
    })
    const headers = { authorization: 'Bearer good' }
    expect((await app.inject({
      method: 'GET', url: `/v1/places/${placeId}/visits?limit=51`, headers,
    })).statusCode).toBe(400)
    const cursor = await app.inject({
      method: 'GET', url: `/v1/places/${placeId}/visits?cursor=opaque`, headers,
    })
    expect(cursor.statusCode).toBe(400)
    expect(cursor.json()).toMatchObject({ code: 'PLACE_VISIT_CURSOR_INVALID' })
    await app.close()
  })
})
