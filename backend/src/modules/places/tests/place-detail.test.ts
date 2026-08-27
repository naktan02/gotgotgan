import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  createPlaceDetailReader,
  registerPlaceHttpRoutes,
  type CanonicalResolutionStore,
  type PlaceDetailDocument,
  type PlaceDetailReader,
} from '../index.js'

const requestedPlaceId = '01992d20-2000-7000-8000-000000000001'
const canonicalPlaceId = '01992d20-2000-7000-8000-000000000002'
const document: PlaceDetailDocument = {
  placeId: canonicalPlaceId,
  name: '조용한 라멘 연구소',
  areaLabel: '성수',
  location: { latitude: 37.5445, longitude: 127.056 },
  primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
  taxonomyKeys: ['food.noodle.ramen'],
  evidenceStatus: 'verified',
  projectedAt: '2026-08-26T00:00:00.000Z',
}

function canonical(
  resolution: Awaited<ReturnType<CanonicalResolutionStore['resolve']>>,
): Pick<CanonicalResolutionStore, 'resolve'> {
  return { resolve: async () => resolution }
}

describe('place detail reader', () => {
  it('returns public facts without reading personal state for an anonymous request', async () => {
    const readPersonal = vi.fn()
    const read = createPlaceDetailReader({
      canonical: canonical({ status: 'active', placeId: canonicalPlaceId, redirectedFrom: [] }),
      readDocument: async () => document,
      readPersonal,
    })

    await expect(read({ requestedPlaceId: canonicalPlaceId })).resolves.toEqual({
      status: 'found',
      detail: expect.objectContaining({
        schemaVersion: 'place-detail.v1',
        status: 'available',
        requestedPlaceId: canonicalPlaceId,
        placeId: canonicalPlaceId,
        name: document.name,
      }),
    })
    expect(readPersonal).not.toHaveBeenCalled()
  })

  it('resolves redirects before adding authoritative personal state', async () => {
    const read = createPlaceDetailReader({
      canonical: canonical({
        status: 'active',
        placeId: canonicalPlaceId,
        redirectedFrom: [requestedPlaceId],
      }),
      readDocument: async (placeId) => placeId === canonicalPlaceId ? document : undefined,
      readPersonal: async () => ({
        preferences: {
          saved: true,
          wanted: false,
          personalRating: 4.4,
          updatedAt: '2026-08-26T01:00:00.000Z',
        },
        visits: {
          visited: true,
          count: 2,
          firstVisitedAt: '2026-07-01T00:00:00.000Z',
          lastVisitedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    })

    const result = await read({ requestedPlaceId, memberId: 'member-1' })
    expect(result).toEqual({
      status: 'found',
      detail: expect.objectContaining({
        status: 'redirected',
        requestedPlaceId,
        placeId: canonicalPlaceId,
        redirectedFrom: [requestedPlaceId],
        personalState: expect.objectContaining({
          saved: true,
          personalRating: 4.4,
          visits: expect.objectContaining({ visited: true, count: 2 }),
        }),
      }),
    })
  })

  it('distinguishes missing, retired, and not-yet-projected places', async () => {
    const readPersonal = async () => ({ visits: { visited: false as const, count: 0 as const } })
    const missing = createPlaceDetailReader({
      canonical: canonical({ status: 'not-found' }), readDocument: async () => document, readPersonal,
    })
    const retired = createPlaceDetailReader({
      canonical: canonical({ status: 'retired', placeId: canonicalPlaceId, redirectedFrom: [] }),
      readDocument: async () => document,
      readPersonal,
    })
    const unavailable = createPlaceDetailReader({
      canonical: canonical({ status: 'active', placeId: canonicalPlaceId, redirectedFrom: [] }),
      readDocument: async () => undefined,
      readPersonal,
    })

    await expect(missing({ requestedPlaceId })).resolves.toEqual({ status: 'not-found' })
    await expect(retired({ requestedPlaceId })).resolves.toEqual({ status: 'retired', placeId: canonicalPlaceId })
    await expect(unavailable({ requestedPlaceId })).resolves.toEqual({ status: 'unavailable', placeId: canonicalPlaceId })
  })
})

describe('place detail HTTP boundary', () => {
  function application(read: PlaceDetailReader) {
    const app = Fastify({ logger: false })
    registerPlaceHttpRoutes(app, {
      read,
      authorizer: async (authorization) => {
        if (authorization === 'Bearer good') return { status: 'authorized', memberId: 'member-1' }
        if (authorization === 'Bearer denied') return { status: 'access-denied' }
        return { status: 'authentication-required' }
      },
    })
    return app
  }

  it('allows anonymous detail and enriches a valid optional bearer request', async () => {
    const read = vi.fn<PlaceDetailReader>(async ({ memberId }) => ({
      status: 'found',
      detail: {
        schemaVersion: 'place-detail.v1',
        status: 'available',
        requestedPlaceId: canonicalPlaceId,
        placeId: canonicalPlaceId,
        redirectedFrom: [],
        name: document.name,
        areaLabel: document.areaLabel,
        location: document.location,
        primaryTaxonomy: document.primaryTaxonomy,
        taxonomyKeys: document.taxonomyKeys,
        evidence: { status: document.evidenceStatus, projectedAt: document.projectedAt },
        ...(memberId === undefined ? {} : {
          personalState: {
            saved: false,
            wanted: false,
            personalRating: null,
            preferencesUpdatedAt: null,
            visits: { visited: false, count: 0 },
          },
        }),
      },
    }))
    const app = application(read)

    const anonymous = await app.inject({ method: 'GET', url: `/v1/places/${canonicalPlaceId}` })
    const member = await app.inject({
      method: 'GET',
      url: `/v1/places/${canonicalPlaceId}`,
      headers: { authorization: 'Bearer good' },
    })

    expect(anonymous.statusCode).toBe(200)
    expect(anonymous.json()).not.toHaveProperty('personalState')
    expect(member.statusCode).toBe(200)
    expect(member.json()).toHaveProperty('personalState.visits.count', 0)
    expect(read).toHaveBeenNthCalledWith(2, { requestedPlaceId: canonicalPlaceId, memberId: 'member-1' })
    await app.close()
  })

  it('rejects an invalid optional bearer and maps lifecycle outcomes', async () => {
    const outcomes: Array<Awaited<ReturnType<PlaceDetailReader>>> = [
      { status: 'not-found' },
      { status: 'retired', placeId: canonicalPlaceId },
      { status: 'unavailable', placeId: canonicalPlaceId },
    ]
    const read = vi.fn<PlaceDetailReader>(async () => outcomes.shift()!)
    const app = application(read)

    const denied = await app.inject({
      method: 'GET', url: `/v1/places/${canonicalPlaceId}`,
      headers: { authorization: 'Bearer bad' },
    })
    expect(denied.statusCode).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect((await app.inject({
      method: 'GET', url: `/v1/places/${canonicalPlaceId}`,
      headers: { authorization: 'Bearer denied' },
    })).statusCode).toBe(403)

    expect((await app.inject({ method: 'GET', url: `/v1/places/${canonicalPlaceId}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/places/${canonicalPlaceId}` })).statusCode).toBe(410)
    const unavailable = await app.inject({ method: 'GET', url: `/v1/places/${canonicalPlaceId}` })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toMatchObject({ code: 'PLACE_DETAIL_UNAVAILABLE', retryable: true })
    await app.close()
  })

  it('fails closed when optional-member authorization is unavailable', async () => {
    const app = Fastify({ logger: false })
    registerPlaceHttpRoutes(app, {
      read: async () => ({ status: 'not-found' }),
      authorizer: async () => { throw new Error('private authorization failure') },
    })

    const response = await app.inject({
      method: 'GET', url: `/v1/places/${canonicalPlaceId}`,
      headers: { authorization: 'Bearer present' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      code: 'PLACE_AUTHORIZATION_UNAVAILABLE',
      retryable: true,
    })
    expect(JSON.stringify(response.json())).not.toContain('private authorization failure')
    await app.close()
  })
})
