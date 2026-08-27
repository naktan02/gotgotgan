import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberId = '01992d20-2000-7000-8000-000000000101'
const placeId = '01992d20-2000-7000-8000-000000000201'
const retiredPlaceId = '01992d20-2000-7000-8000-000000000202'
const unprojectedPlaceId = '01992d20-2000-7000-8000-000000000203'
const at = '2026-08-26T10:00:00.000Z'

test('place detail joins canonical facts with an authorized personal overlay', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-detail')
  let application
  try {
    const library = await import('../../dist/modules/library/index.js')
    const places = await import('../../dist/modules/places/index.js')
    const search = await import('../../dist/modules/search/index.js')
    const visits = await import('../../dist/modules/visits/index.js')
    const http = await import('../../dist/entrypoints/http/app.js')

    const libraryStore = new library.PostgresLibraryStore(database.pool)
    const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
    const localSearch = new search.PostgresLocalSearch(database.pool)
    const visitStore = new visits.PostgresVisitStore(database.pool)

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES ($1,'https://identity.example.test','place-detail-member','active','member','standard','unclassified',$2,$2)`,
      [memberId, at],
    )
    await database.pool.query(
      `INSERT INTO places.canonical_places (id, status, retired_at)
       VALUES ($1, 'active', NULL), ($2, 'retired', $4), ($3, 'active', NULL)`,
      [placeId, retiredPlaceId, unprojectedPlaceId, at],
    )
    await search.projectLocalPlace({
      placeId,
      sourceVersion: 1,
      name: '조용한 라멘 연구소',
      areaLabel: '성수',
      latitude: 37.5445,
      longitude: 127.056,
      primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
      taxonomyKeys: ['food.noodle.ramen'],
      evidenceStatus: 'verified',
      projectedAt: at,
    }, localSearch)
    await library.applyLibraryCommand({
      commandId: '01992d20-2000-7000-8000-000000000301',
      memberId,
      occurredAt: at,
      command: {
        kind: 'set-place-preferences', placeId,
        saved: true, wanted: false, personalRating: 4.4,
      },
      store: libraryStore,
    })
    for (const [id, visitedAt] of [
      ['01992d20-2000-7000-8000-000000000401', '2026-07-01T12:00:00.000Z'],
      ['01992d20-2000-7000-8000-000000000402', '2026-08-01T12:00:00.000Z'],
    ]) {
      await visits.recordVisit({ id, memberId, placeId, visitedAt, recordedAt: at, store: visitStore })
    }

    const read = places.createPlaceDetailReader({
      canonical: canonicalStore,
      readDocument: async (id) => {
        const document = await localSearch.getPlaceDocument(id)
        return document === undefined ? undefined : {
          placeId: document.placeId,
          name: document.name,
          areaLabel: document.areaLabel,
          location: { latitude: document.latitude, longitude: document.longitude },
          primaryTaxonomy: document.primaryTaxonomy,
          taxonomyKeys: document.taxonomyKeys,
          evidenceStatus: document.evidenceStatus,
          projectedAt: document.projectedAt,
        }
      },
      readPersonal: async (viewerMemberId, id) => {
        const [preferences, visitSummary] = await Promise.all([
          libraryStore.getPlacePreferences(viewerMemberId, id),
          visitStore.summarize(viewerMemberId, id),
        ])
        return {
          ...(preferences === undefined ? {} : { preferences }),
          visits: visitSummary,
        }
      },
    })
    application = http.buildHttpApplication({
      places: {
        read,
        authorizer: async (authorization) => authorization === 'Bearer good'
          ? { status: 'authorized', memberId }
          : { status: 'authentication-required' },
      },
    })

    const anonymous = await application.inject({ method: 'GET', url: `/v1/places/${placeId}` })
    assert.equal(anonymous.statusCode, 200)
    assert.equal(anonymous.json().name, '조용한 라멘 연구소')
    assert.equal(anonymous.json().personalState, undefined)

    const personal = await application.inject({
      method: 'GET', url: `/v1/places/${placeId}`,
      headers: { authorization: 'Bearer good' },
    })
    assert.equal(personal.statusCode, 200)
    assert.deepEqual(personal.json().personalState, {
      saved: true,
      wanted: false,
      personalRating: 4.4,
      preferencesUpdatedAt: at,
      visits: {
        visited: true,
        count: 2,
        firstVisitedAt: '2026-07-01T12:00:00.000Z',
        lastVisitedAt: '2026-08-01T12:00:00.000Z',
      },
    })

    const rejected = await application.inject({
      method: 'GET', url: `/v1/places/${placeId}`,
      headers: { authorization: 'Bearer bad' },
    })
    assert.equal(rejected.statusCode, 401)
    assert.equal((await application.inject({
      method: 'GET', url: `/v1/places/${retiredPlaceId}`,
    })).statusCode, 410)
    const unprojected = await application.inject({
      method: 'GET', url: `/v1/places/${unprojectedPlaceId}`,
    })
    assert.equal(unprojected.statusCode, 503)
    assert.equal(unprojected.json().retryable, true)
  } finally {
    await application?.close().catch(() => undefined)
    await database.close()
  }
})
