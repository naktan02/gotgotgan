import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-0000-7000-8000-000000000201'
const memberB = '01992d20-0000-7000-8000-000000000202'
const projectedAt = '2026-08-26T00:00:00.000Z'

function document(placeId, name, longitude, taxonomyKey, taxonomyLabel) {
  return {
    placeId, sourceVersion: 1, name, areaLabel: '성수', latitude: 37.5445,
    longitude, primaryTaxonomy: { key: taxonomyKey, label: taxonomyLabel },
    taxonomyKeys: [taxonomyKey], evidenceStatus: 'verified', projectedAt,
  }
}

test('local search is indexed, cursor-bounded, taxonomy-driven, and member-isolated', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-local-search')
  try {
    const searchModule = await import('../../dist/modules/search/index.js')
    const taxonomyModule = await import('../../dist/modules/taxonomy/index.js')
    const local = new searchModule.PostgresLocalSearch(database.pool)
    const taxonomyStore = new taxonomyModule.PostgresTaxonomyStore(database.pool)
    const search = searchModule.createPlaceSearch({ sources: [local] })

    const ramenNode = {
      key: 'food.noodle.ramen', parentKey: null, label: '라멘', kind: 'category',
      version: 1, active: true, effectiveAt: projectedAt,
    }
    assert.equal(await taxonomyModule.publishTaxonomyNode(ramenNode, taxonomyStore), 'published')
    assert.equal(await taxonomyModule.publishTaxonomyNode(ramenNode, taxonomyStore), 'replayed')
    await assert.rejects(
      taxonomyModule.publishTaxonomyNode({ ...ramenNode, label: '다른 의미' }, taxonomyStore),
      taxonomyModule.TaxonomyVersionConflictError,
    )
    assert.deepEqual(await taxonomyModule.listCurrentTaxonomy(taxonomyStore), {
      schemaVersion: 'place-taxonomy.v1',
      nodes: [{ key: ramenNode.key, parentKey: null, label: '라멘', kind: 'category', version: 1 }],
    })

    const places = [
      document('01992d20-0000-7000-8000-000000000101', '성수 라멘 하나', 127.056, 'food.noodle.ramen', '라멘'),
      document('01992d20-0000-7000-8000-000000000102', '성수 라멘 둘', 127.061, 'food.noodle.ramen', '라멘'),
      document('01992d20-0000-7000-8000-000000000103', '동쪽 전시실', 127.132, 'culture.exhibition', '전시'),
      document('01992d20-0000-7000-8000-000000000104', '성수 카페', 127.051, 'drink.coffee', '카페'),
    ]
    for (const place of places) await searchModule.projectLocalPlace(place, local)
    await searchModule.projectMemberSearchSignal({
      memberId: memberA, placeId: places[0].placeId, sourceVersion: 1,
      saved: true, wanted: false, visited: true, personalRating: 4.4, projectedAt,
    }, local)
    await searchModule.projectMemberSearchSignal({
      memberId: memberB, placeId: places[0].placeId, sourceVersion: 1,
      saved: false, wanted: true, visited: true, personalRating: 5.0, projectedAt,
    }, local)

    const first = await search({ query: '라멘', filters: { taxonomyKeys: [] }, limit: 1 })
    assert.equal(first.items.length, 1)
    assert.ok(first.nextCursor)
    const second = await search({ query: '라멘', filters: { taxonomyKeys: [] }, limit: 1, cursor: first.nextCursor })
    assert.equal(second.items.length, 1)
    assert.notEqual(first.items[0].resultId, second.items[0].resultId)
    assert.equal(first.items[0].identity.kind, 'canonical')

    const bounded = await search({
      query: '', filters: { taxonomyKeys: [] }, limit: 20,
      bounds: { west: 127.1, south: 37.5, east: 127.16, north: 37.58 },
    })
    assert.deepEqual(bounded.items.map((item) => item.name), ['동쪽 전시실'])

    const classified = await search({
      query: '', filters: { taxonomyKeys: ['drink.coffee'] }, limit: 20,
    })
    assert.deepEqual(classified.items.map((item) => item.name), ['성수 카페'])

    const memberResult = await search({
      query: '', filters: { taxonomyKeys: [], saved: true, minimumPersonalRating: 4.4 },
      limit: 20, viewerMemberId: memberA,
    })
    assert.equal(memberResult.items.length, 1)
    assert.deepEqual(memberResult.items[0].personalState, {
      saved: true, wanted: false, visited: true, personalRating: 4.4,
    })
    const anonymousResult = await search({ query: '성수 라멘 하나', filters: { taxonomyKeys: [] }, limit: 20 })
    assert.equal(anonymousResult.items[0].personalState, undefined)
    assert.doesNotMatch(JSON.stringify(memberResult), new RegExp(memberB))
    assert.doesNotMatch(JSON.stringify(memberResult), /5\.0/)

    await database.pool.query(`
      INSERT INTO search.place_documents (
        place_id, source_version, display_name, area_label, search_text, location,
        primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys, evidence_status, projected_at
      )
      SELECT
        (substr(md5(sequence::text), 1, 8) || '-' || substr(md5(sequence::text), 9, 4) || '-4' ||
         substr(md5(sequence::text), 14, 3) || '-8' || substr(md5(sequence::text), 18, 3) || '-' ||
         substr(md5(sequence::text), 21, 12))::uuid,
        1, '대표 볼륨 카페 ' || sequence, '테스트 지역', '대표 볼륨 카페 ' || sequence,
        ST_SetSRID(ST_MakePoint(126.9 + (sequence % 100) * 0.001, 37.4 + (sequence % 100) * 0.001), 4326),
        'drink.coffee', '카페', ARRAY['drink.coffee'], 'verified', CURRENT_TIMESTAMP
      FROM generate_series(1000, 5999) AS sequence
      ON CONFLICT (place_id) DO NOTHING
    `)
    await database.pool.query('ANALYZE search.place_documents')
    await database.pool.query('SET enable_seqscan = off')
    const textPlan = await database.pool.query(`EXPLAIN (FORMAT JSON) SELECT place_id FROM search.place_documents WHERE search_text % '대표 볼륨 카페 1200'`)
    const spatialPlan = await database.pool.query(`EXPLAIN (FORMAT JSON) SELECT place_id FROM search.place_documents WHERE location && ST_MakeEnvelope(126.9, 37.4, 126.95, 37.45, 4326)`)
    const taxonomyPlan = await database.pool.query(`EXPLAIN (FORMAT JSON) SELECT place_id FROM search.place_documents WHERE taxonomy_keys && ARRAY['drink.coffee']::text[]`)
    assert.match(JSON.stringify(textPlan.rows[0]), /search_place_documents_text_trgm/)
    assert.match(JSON.stringify(spatialPlan.rows[0]), /search_place_documents_location_gist/)
    assert.match(JSON.stringify(taxonomyPlan.rows[0]), /search_place_documents_taxonomy_gin/)

    await assert.rejects(
      database.pool.query(`UPDATE taxonomy.node_versions SET label = 'rewrite' WHERE node_key = 'food.noodle.ramen'`),
      (error) => error?.code === '42501',
    )
    const extensions = await database.administratorClient.query(`
      SELECT extname, pg_get_userbyid(extowner) AS owner
      FROM pg_extension WHERE extname = ANY(ARRAY['postgis', 'pg_trgm'])
      ORDER BY extname
    `)
    assert.deepEqual(extensions.rows, [
      { extname: 'pg_trgm', owner: 'place_admin' },
      { extname: 'postgis', owner: 'place_admin' },
    ])
  } finally {
    await database.close()
  }
})
