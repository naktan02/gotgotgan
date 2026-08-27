import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const at = '2026-08-28T07:00:00.000Z'
const ids = {
  naver: '01993030-0000-7000-8000-000000000001',
  google: '01993030-0000-7000-8000-000000000002',
  kakao: '01993030-0000-7000-8000-000000000003',
}

test('cross-provider resolution indexes multilingual evidence and records review-only assessments', { timeout: 90_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-identity-resolution')
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const resolution = await import('../../dist/modules/resolution/index.js')
    const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
    const store = new resolution.PostgresPlaceIdentityResolution(database.pool)

    async function observe({ id, providerKey, externalPlaceId, name, checksum }) {
      await ingestion.recordSourceObservation({
        id,
        providerKey,
        externalPlaceId,
        acquisitionKind: 'documented-api',
        payloadChecksum: checksum,
        parserVersion: `${providerKey}-fixture.v1`,
        observedAt: at,
        acquiredAt: at,
        facts: { name },
        confidence: 0.9,
        store: ingestionStore,
      })
    }

    await observe({
      id: ids.naver,
      providerKey: 'naver',
      externalPlaceId: 'naver-civic-hall',
      name: '서울시민청',
      checksum: 'a'.repeat(64),
    })
    const first = resolution.createPlaceIdentityResolver({ store, now: () => new Date(at) })
    assert.deepEqual(await first.evaluate({
      sourceObservationId: ids.naver,
      providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-civic-hall' },
      observedAt: at,
      names: [{ text: '서울시민청', languageTag: 'ko' }],
      address: '대한민국 서울특별시 중구',
      phone: '02-120-0000',
      location: { latitude: 37.5665, longitude: 126.978 },
    }), {
      status: 'evaluated',
      sourceObservationId: ids.naver,
      assessments: [],
    })

    await observe({
      id: ids.google,
      providerKey: 'google',
      externalPlaceId: 'google-civic-hall',
      name: 'Seoul Citizens Hall',
      checksum: 'b'.repeat(64),
    })
    const googleEvidence = {
      sourceObservationId: ids.google,
      providerIdentity: { providerKey: 'google', externalPlaceId: 'google-civic-hall' },
      observedAt: at,
      names: [{ text: 'Seoul Citizens Hall', languageTag: 'en' }],
      address: 'Jung-gu, Seoul, Republic of Korea',
      phone: '+82 2-120-0000',
      location: { latitude: 37.56651, longitude: 126.97801 },
    }
    const googleResult = await first.evaluate(googleEvidence)
    assert.equal(googleResult.assessments.length, 1)
    assert.deepEqual(googleResult.assessments[0], {
      comparedObservationId: ids.naver,
      classification: 'likely-same',
      confidence: 0.8,
      reasons: ['cross-script-name', 'exact-phone', 'nearby-location'],
      persistence: 'recorded',
    })

    const replay = resolution.createPlaceIdentityResolver({
      store,
      now: () => new Date('2026-08-28T07:05:00.000Z'),
    })
    const replayed = await replay.evaluate(googleEvidence)
    assert.equal(replayed.status, 'replayed')
    assert.equal(replayed.assessments[0].persistence, 'replayed')

    await observe({
      id: ids.kakao,
      providerKey: 'kakao',
      externalPlaceId: 'kakao-distant-civic-hall',
      name: 'Seoul Citizens Hall',
      checksum: 'c'.repeat(64),
    })
    const kakaoResult = await first.evaluate({
      sourceObservationId: ids.kakao,
      providerIdentity: { providerKey: 'kakao', externalPlaceId: 'kakao-distant-civic-hall' },
      observedAt: at,
      names: [{ text: 'Seoul Citizens Hall', languageTag: 'en' }],
      location: { latitude: 37.45, longitude: 127.15 },
    })
    assert.ok(kakaoResult.assessments.some((assessment) =>
      assessment.comparedObservationId === ids.google &&
      assessment.classification === 'likely-different' &&
      assessment.reasons.includes('far-apart-concurrent-observations')))

    const state = await database.administratorClient.query(`
      SELECT
        (SELECT count(*)::int FROM resolution.place_evidence_index) AS evidence_count,
        (SELECT count(*)::int FROM resolution.match_assessments) AS assessment_count,
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_count,
        (SELECT names FROM resolution.place_evidence_index
          WHERE provider_key = 'google') AS google_names,
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'resolution'
            AND indexname IN (
              'place_evidence_name_trgm', 'place_evidence_address_trgm',
              'place_evidence_location_gist', 'place_evidence_phone',
              'place_evidence_website_host'
            )) AS candidate_indexes
    `)
    assert.deepEqual(state.rows, [{
      evidence_count: 3,
      assessment_count: 2,
      canonical_count: 0,
      google_names: [{
        rawText: 'Seoul Citizens Hall',
        languageTag: 'en',
        normalizedText: 'seoul citizens hall',
        scripts: ['latin'],
      }],
      candidate_indexes: 5,
    }])

    await assert.rejects(
      database.pool.query(`UPDATE resolution.match_assessments SET confidence = 0.1`),
      (error) => error?.code === '42501',
    )
  } finally {
    await database.close()
  }
})
