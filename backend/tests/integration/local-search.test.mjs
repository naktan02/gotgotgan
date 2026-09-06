import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-0000-7000-8000-000000000201'
const memberB = '01992d20-0000-7000-8000-000000000202'
const projectedAt = '2026-08-26T00:00:00.000Z'

function document(placeId, name, longitude, taxonomyKey, taxonomyLabel) {
  return {
    placeId, sourceVersion: 1, name, areaLabel: '성수', latitude: 37.5445,
    areaReference: { key: 'kr.seoul.seongsu', version: 3 },
    longitude, primaryTaxonomy: { key: taxonomyKey, label: taxonomyLabel },
    taxonomyKeys: [taxonomyKey],
    taxonomyReferences: [{ key: taxonomyKey, version: 1, kind: 'category' }],
    evidenceStatus: 'verified', projectedAt,
  }
}

test('catalog name intent ranks public names and keeps map and exploration candidates consistent', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-catalog-name-search')
  try {
    const searchModule = await import('../../dist/modules/search/index.js')
    const local = new searchModule.PostgresLocalSearch(database.pool)
    const vocabulary = { listAreas: async () => [], listTaxonomies: async () => [] }
    const search = searchModule.createCatalogPlaceSearch({ source: local, vocabulary })
    const names = ['espresso laboratory', 'ramenhous', 'the ramenhouse shop', 'ramenhouse north', 'ramenhouse']
    for (const [index, name] of names.entries()) {
      await searchModule.projectLocalPlace(document(
        `01992d20-0000-7000-8000-00000000030${index}`, name, 127.05,
        'drink.coffee', 'ramenhouse',
      ), local)
    }
    const result = await search({ intent: 'name', query: 'ramenhouse', excludedTokenIds: [], limit: 20 })
    assert.deepEqual(result.items.map((item) => item.name), [
      'ramenhouse', 'ramenhouse north', 'the ramenhouse shop', 'ramenhous',
    ])
    const projectMap = searchModule.createCatalogPlaceMapSearch({
      source: new searchModule.PostgresCatalogMapSearch(database.pool), vocabulary,
    })
    const map = await projectMap({
      intent: 'name', query: 'ramenhouse', excludedTokenIds: [],
      viewport: { west: 127, south: 37, east: 128, north: 38 }, zoom: 14, maxFeatures: 384,
    })
    assert.deepEqual(map.features.map((item) => item.placeId).sort(), result.items.map((item) => item.placeId).sort())
    const explore = searchModule.createCatalogExploration({ source: local, vocabulary, destinations: () => [] })
    const exploration = await explore('ramenhouse')
    assert.deepEqual(exploration.places, result.items)
  } finally {
    await database.close()
  }
})

test('name search orders all same-name branches by near before pagination and binds its cursor', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-catalog-name-near')
  try {
    const searchModule = await import('../../dist/modules/search/index.js')
    const local = new searchModule.PostgresLocalSearch(database.pool)
    const vocabulary = { listAreas: async () => [], listTaxonomies: async () => [] }
    const search = searchModule.createCatalogPlaceSearch({ source: local, vocabulary })
    const ids = []
    for (let index = 0; index < 12; index += 1) {
      const placeId = `01992d20-0000-7000-8000-${String(400 + index).padStart(12, '0')}`
      ids.push(placeId)
      await searchModule.projectLocalPlace(document(placeId, 'BranchCafe', 126 + index / 10, 'drink.coffee', '카페'), local)
    }
    const unknownId = '01992d20-0000-7000-8000-000000000412'
    await database.pool.query(`INSERT INTO search.place_documents (
      place_id, source_version, display_name, search_text, location, taxonomy_keys, evidence_status, projected_at
    ) VALUES ($1::uuid, 1, 'BranchCafe', 'branchcafe', NULL, '{}', 'unverified', $2::timestamptz)`, [unknownId, projectedAt])
    const input = { intent: 'name', query: 'BranchCafe', excludedTokenIds: [], limit: 8,
      near: { latitude: 37.5445, longitude: 128 } }
    const first = await search(input)
    assert.deepEqual(first.items.map((item) => item.placeId), [...ids].reverse().slice(0, 8))
    assert.ok(first.nextCursor)
    const second = await search({ ...input, cursor: first.nextCursor })
    assert.deepEqual(second.items.map((item) => item.placeId), [...ids].reverse().slice(8).concat(unknownId))
    assert.equal(second.nextCursor, undefined)
    assert.equal(second.items.at(-1).location, null)
    const single = await search({ ...input, limit: 1 })
    const withoutNear = await search({ ...input, near: undefined, limit: 1 })
    assert.equal(single.items[0].placeId, ids.at(-1))
    assert.equal(withoutNear.items[0].placeId, ids[0])
    const explored = await searchModule.createCatalogExploration({ source: local, vocabulary, destinations: () => [] })('BranchCafe', input.near)
    assert.deepEqual(explored.places.map((item) => item.placeId), first.items.map((item) => item.placeId))
    for (const changed of [{ near: { latitude: 37.5445, longitude: 126 } }, { intent: 'auto' }, { query: 'Branch' }]) {
      await assert.rejects(search({ ...input, ...changed, cursor: first.nextCursor }), searchModule.InvalidSearchCursorError)
    }
    const legacyInput = { query: 'branchcafe', taxonomyReferences: [], limit: 8 }
    const legacyFirst = await local.searchCatalog(legacyInput)
    assert.equal(JSON.parse(Buffer.from(legacyFirst.nextCursor, 'base64url')).version, 1)
    const legacyNext = await local.searchCatalog({ ...legacyInput, cursor: legacyFirst.nextCursor })
    assert.equal(legacyNext.items.length, 5)
    await assert.rejects(search({ ...input, cursor: legacyFirst.nextCursor }), searchModule.InvalidSearchCursorError)
    const invalidDistance = { ...JSON.parse(Buffer.from(first.nextCursor, 'base64url')), distance: -1 }
    await assert.rejects(search({ ...input, cursor: Buffer.from(JSON.stringify(invalidDistance)).toString('base64url') }), searchModule.InvalidSearchCursorError)
    const bounded = await search({ ...input, limit: 20, bounds: { west: 126.65, south: 37, east: 127.05, north: 38 } })
    assert.deepEqual(bounded.items.map((item) => item.placeId), ids.slice(7, 11).reverse())
    const noNearSecond = await search({ ...input, near: undefined, limit: 1, cursor: withoutNear.nextCursor })
    assert.equal(noNearSecond.items[0].placeId, ids[1])
    const nearUnknown = await search({ ...input, limit: 12 })
    assert.equal((await search({ ...input, limit: 12, cursor: nearUnknown.nextCursor })).items[0].placeId, unknownId)
    for (const [index, longitude] of [179, -179].entries()) {
      await searchModule.projectLocalPlace(document(
        `01992d20-0000-7000-8000-00000000042${index}`, 'DatelineName', longitude, 'drink.coffee', '카페',
      ), local)
    }
    const viewport = { west: 170, south: 37, east: -170, north: 38 }
    const crossing = await search({ ...input, query: 'DatelineName', bounds: viewport })
    assert.equal(crossing.items.length, 2)
    const crossingMap = await searchModule.createCatalogPlaceMapSearch({
      source: new searchModule.PostgresCatalogMapSearch(database.pool), vocabulary,
    })({ intent: 'name', query: 'DatelineName', excludedTokenIds: [], viewport, zoom: 14, maxFeatures: 384 })
    assert.deepEqual(crossingMap.features.map((item) => item.placeId).sort(), crossing.items.map((item) => item.placeId).sort())
  } finally {
    await database.close()
  }
})

test('local search is indexed, cursor-bounded, taxonomy-driven, and member-isolated', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-local-search')
  try {
    const searchModule = await import('../../dist/modules/search/index.js')
    const taxonomyModule = await import('../../dist/modules/taxonomy/index.js')
    const local = new searchModule.PostgresLocalSearch(database.pool)
    const catalogMap = new searchModule.PostgresCatalogMapSearch(database.pool)
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

    const catalog = await local.searchCatalog({
      query: '',
      areaReference: { key: 'kr.seoul.seongsu', version: 3 },
      taxonomyReferences: [{ key: 'drink.coffee', version: 1 }],
      limit: 20,
    })
    assert.deepEqual(catalog.items.map((item) => item.name), ['성수 카페'])
    assert.deepEqual(catalog.items[0].area.reference, {
      key: 'kr.seoul.seongsu', version: 3,
    })
    assert.deepEqual(catalog.items[0].taxonomyReferences, [{
      key: 'drink.coffee', version: 1, kind: 'category',
    }])
    const catalogFirstPage = await local.searchCatalog({
      query: '', taxonomyReferences: [], limit: 1,
    })
    assert.ok(catalogFirstPage.nextCursor)
    await assert.rejects(
      local.searchCatalog({
        query: '라멘', taxonomyReferences: [], limit: 1,
        cursor: catalogFirstPage.nextCursor,
      }),
      searchModule.InvalidSearchCursorError,
    )
    const wrongCatalogVersion = await local.searchCatalog({
      query: '',
      areaReference: { key: 'kr.seoul.seongsu', version: 2 },
      taxonomyReferences: [],
      limit: 20,
    })
    assert.equal(wrongCatalogVersion.items.length, 0)
    for (const [index, longitude] of [179, 179.5, -179].entries()) {
      await searchModule.projectLocalPlace({
        placeId: `01992d20-0000-7000-8000-00000000015${index}`,
        sourceVersion: 1,
        name: `dateline cafe ${index}`,
        areaLabel: '날짜변경선',
        areaReference: { key: 'global.dateline', version: 1 },
        latitude: index,
        longitude,
        primaryTaxonomy: { key: 'drink.coffee', label: '카페' },
        taxonomyKeys: ['drink.coffee'],
        taxonomyReferences: [{ key: 'drink.coffee', version: 1, kind: 'category' }],
        evidenceStatus: 'verified',
        projectedAt,
      }, local)
    }
    const crossingMapQuery = {
      query: 'dateline',
      areaReferences: [],
      taxonomyReferenceGroups: [],
      viewport: { west: 170, south: -10, east: -170, north: 10 },
      zoom: 2,
      maxFeatures: 384,
    }
    const crossingCatalog = await local.searchCatalog({
      query: 'dateline', taxonomyReferences: [], limit: 20,
      bounds: crossingMapQuery.viewport,
    })
    assert.deepEqual(crossingCatalog.items.map((item) => item.name), [
      'dateline cafe 0', 'dateline cafe 1', 'dateline cafe 2',
    ])
    const eastCatalog = await local.searchCatalog({
      query: 'dateline', taxonomyReferences: [], limit: 20,
      bounds: { west: 170, south: -10, east: 180, north: 10 },
    })
    assert.deepEqual(eastCatalog.items.map((item) => item.name), [
      'dateline cafe 0', 'dateline cafe 1',
    ])
    const wideMap = await catalogMap.projectCatalogMap(crossingMapQuery)
    assert.equal(wideMap.mode, 'clusters')
    assert.equal(wideMap.matchingPlaceCount, 3)
    assert.equal(wideMap.features.reduce((sum, feature) => sum + feature.placeCount, 0), 3)
    assert.ok(wideMap.features.length <= 384)
    const detailedMap = await catalogMap.projectCatalogMap({ ...crossingMapQuery, zoom: 14 })
    assert.equal(detailedMap.mode, 'places')
    assert.deepEqual(detailedMap.features.map((feature) => feature.kind), [
      'place', 'place', 'place',
    ])
    const eastSideMap = await catalogMap.projectCatalogMap({
      ...crossingMapQuery,
      viewport: { west: 170, south: -10, east: 180, north: 10 },
      zoom: 14,
    })
    assert.equal(eastSideMap.matchingPlaceCount, 2)
    const fullWorldMap = await catalogMap.projectCatalogMap({
      ...crossingMapQuery,
      viewport: { west: -180, south: -85.051129, east: 180, north: 85.051129 },
    })
    assert.equal(fullWorldMap.matchingPlaceCount, 3)
    assert.equal(fullWorldMap.features.reduce(
      (sum, feature) => sum + feature.placeCount,
      0,
    ), 3)
    const densityFallback = await catalogMap.projectCatalogMap({
      ...crossingMapQuery,
      zoom: 14,
      maxFeatures: 1,
    })
    assert.equal(densityFallback.mode, 'clusters')
    assert.equal(densityFallback.features.length, 1)
    assert.equal(densityFallback.features[0].placeCount, 3)
    const parentFiltered = await local.searchCatalog({
      query: '',
      areaReference: { key: 'kr.seoul', version: 1 },
      areaReferences: [
        { key: 'kr.seoul', version: 1 },
        { key: 'kr.seoul.seongsu', version: 3 },
      ],
      taxonomyReferences: [{ key: 'place.food', version: 1 }],
      taxonomyReferenceGroups: [[
        { key: 'food.noodle.ramen', version: 1, kind: 'category' },
        { key: 'drink.coffee', version: 1, kind: 'category' },
      ]],
      limit: 20,
    })
    assert.deepEqual(parentFiltered.items.map((item) => item.name).sort(), [
      '성수 라멘 둘', '성수 라멘 하나', '성수 카페',
    ])
    const tamperedCatalogCursor = JSON.parse(Buffer.from(
      catalogFirstPage.nextCursor,
      'base64url',
    ).toString('utf8'))
    tamperedCatalogCursor.placeId = 'not-a-uuid'
    await assert.rejects(
      local.searchCatalog({
        query: '', taxonomyReferences: [], limit: 1,
        cursor: Buffer.from(JSON.stringify(tamperedCatalogCursor)).toString('base64url'),
      }),
      searchModule.InvalidSearchCursorError,
    )

    await database.pool.query(`
      INSERT INTO search.place_documents (
        place_id, source_version, display_name, area_label, search_text, location,
        primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
        evidence_status, projected_at
      ) VALUES (
        '01992d20-0000-7000-8000-000000000199', 1,
        '위치 확인 중인 새 장소', NULL, '위치 확인 중인 새 장소', NULL,
        NULL, NULL, '{}', 'unverified', $1::timestamptz
      )
    `, [projectedAt])
    const unlocatedCatalog = await local.searchCatalog({
      query: '위치 확인 중인 새 장소', taxonomyReferences: [], limit: 20,
    })
    assert.equal(unlocatedCatalog.items[0].location, null)
    const unlocatedLegacy = await search({
      query: '위치 확인 중인 새 장소', filters: { taxonomyKeys: [] }, limit: 20,
    })
    assert.equal(unlocatedLegacy.items.length, 0)

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
    const catalogAreaPlan = await database.pool.query(`EXPLAIN (FORMAT JSON) SELECT place_id FROM search.place_documents WHERE area_key = 'kr.seoul.seongsu' AND area_version = 3`)
    const catalogTaxonomyPlan = await database.pool.query(`EXPLAIN (FORMAT JSON) SELECT place_id FROM search.place_documents WHERE taxonomy_references @> '[{"key":"drink.coffee","version":1}]'::jsonb`)
    assert.match(JSON.stringify(textPlan.rows[0]), /search_place_documents_text_trgm/)
    assert.match(JSON.stringify(spatialPlan.rows[0]), /search_place_documents_location_gist/)
    assert.match(JSON.stringify(taxonomyPlan.rows[0]), /search_place_documents_taxonomy_gin/)
    assert.match(JSON.stringify(catalogAreaPlan.rows[0]), /search_place_documents_area_version/)
    assert.match(JSON.stringify(catalogTaxonomyPlan.rows[0]), /search_place_documents_taxonomy_references_gin/)

    await assert.rejects(
      database.pool.query(`UPDATE search.place_documents
        SET taxonomy_references = '[{"key":"drink.coffee","version":1,"kind":"category","raw":"forbidden"}]'::jsonb
        WHERE display_name = '성수 카페'`),
      (error) => error?.code === '23514',
    )

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
