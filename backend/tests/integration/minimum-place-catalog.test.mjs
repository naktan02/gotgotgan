import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

test('minimum venue facts survive identity reuse, projection failure and missing coordinates without personal disclosure', { timeout: 180_000 }, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-minimum-catalog')
  const singleConnection = new Pool({ connectionString: database.pool.options.connectionString, max: 1, connectionTimeoutMillis: 1_000 })
  try {
    const { PostgresMinimumPlaceCatalog } = await import('../../dist/modules/places/index.js')
    const { PostgresCanonicalCatalogProjection, PostgresLocalSearch } = await import('../../dist/modules/search/index.js')
    const { createMinimumPlacePublication } = await import('../../dist/entrypoints/catalog/minimum-place-publication.js')
    const catalog = new PostgresMinimumPlaceCatalog(singleConnection)
    const projection = new PostgresCanonicalCatalogProjection(database.pool)
    const local = new PostgresLocalSearch(database.pool)
    const at = '2026-09-06T00:00:00.000Z'
    async function fixture(name, location = { latitude: 37.5, longitude: 127.0 }) {
      const placeId = randomUUID()
      const observationId = randomUUID()
      const externalPlaceId = randomUUID()
      await database.pool.query('INSERT INTO places.canonical_places (id) VALUES ($1)', [placeId])
      await database.pool.query(
        `INSERT INTO places.provider_place_identities (provider_key, external_place_id, canonical_place_id, linked_by_decision_id, linked_at)
         VALUES ('naver',$1,$2,$4,$3)`, [externalPlaceId, placeId, at, randomUUID()],
      )
      await database.pool.query(
        `INSERT INTO ingestion.source_observations (id, provider_key, external_place_id, acquisition_kind,
          payload_checksum, parser_version, observed_at, acquired_at, facts, confidence, fingerprint)
         VALUES ($1,'naver',$2,'structured-web',repeat('a',64),'synthetic-test.v1',$3,$3,$4,0.8,repeat('b',64))`,
        [observationId, externalPlaceId, at, JSON.stringify({ name: '절대 공개하지 않는 개인 별칭', listName: '비공개 목록', note: 'private note' })],
      )
      return {
        placeId, providerKey: 'naver', externalPlaceId, sourceObservationId: observationId,
        observedAt: at, recordedAt: at, publicationBasis: 'provider-listed-facts',
        facts: { schemaVersion: 'minimum-place-facts.v1', name, address: '서울 성동구 테스트로 1', location },
      }
    }
    const first = await fixture('가상 라멘 가게')
    const concurrent = await Promise.all([catalog.publish(first), catalog.publish(first)])
    assert.deepEqual(concurrent.map((item) => item.status).sort(), ['existing', 'published'])
    assert.equal(concurrent[0].current.name, '가상 라멘 가게')
    assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM places.canonical_place_profile_revisions')).rows[0].n, 1)
    assert.equal((await local.getCatalogPlaceDocuments([first.placeId])).length, 0, 'no implicit search write across schemas')
    await projection.project(concurrent[0].current)
    const document = (await local.getCatalogPlaceDocuments([first.placeId]))[0]
    assert.equal(document.name, first.facts.name)
    assert.equal(await projection.project({ ...concurrent[0].current, revision: 2,
      policyVersion: 'curated-rich-profile.v1', name: 'must not replace with a partial rich profile' }), 'skipped')
    assert.equal((await local.getCatalogPlaceDocuments([first.placeId]))[0].name, first.facts.name)
    const searchText = (await database.pool.query('SELECT search_text FROM search.place_documents WHERE place_id=$1', [first.placeId])).rows[0].search_text
    assert.ok(!searchText.includes('비공개') && !searchText.includes('별칭') && !searchText.includes('private'))
    await assert.rejects(() => catalog.publish({ ...first, facts: { ...first.facts, name: 'changed' } }), /reused/)
    await assert.rejects(() => catalog.publish({ ...first, externalPlaceId: randomUUID() }), /do not belong/)
    await assert.rejects(() => catalog.publish({ ...first, facts: { ...first.facts, location: { latitude: 91, longitude: 127 } } }), /location/)

    const noLocation = await fixture('가상 좌표 없는 장소', null)
    await catalog.publish(noLocation)
    assert.equal((await local.getCatalogPlaceDocuments([noLocation.placeId])).length, 0)
    await createMinimumPlacePublication(database.pool).rebuild()
    assert.equal((await local.getCatalogPlaceDocuments([noLocation.placeId]))[0].location, null)
    assert.equal((await catalog.read([noLocation.placeId]))[0].name, noLocation.facts.name)
    await createMinimumPlacePublication(database.pool).rebuild()
    assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM search.place_documents')).rows[0].n, 2)
    await assert.rejects(() => database.pool.query(
      'UPDATE places.canonical_places SET location=ST_SetSRID(ST_MakePoint(1,1),4326) WHERE id=$1', [first.placeId],
    ), /permission denied/, 'runtime still cannot bypass profile activation')
  } finally { await singleConnection.end(); await database.close() }
})
