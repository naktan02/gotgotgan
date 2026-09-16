import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-8000-7000-8000-000000000101'
const memberB = '01992d20-8000-7000-8000-000000000102'
const placeA = '01992d20-8000-7000-8000-000000000201'
const placeB = '01992d20-8000-7000-8000-000000000202'
const collectionA = '01992d20-8000-7000-8000-000000000301'
const collectionA2 = '01992d20-8000-7000-8000-000000000302'
const collectionB = '01992d20-8000-7000-8000-000000000303'
const at = '2026-09-03T00:00:00.000Z'

const context = (operationId) => ({ operationId, memberId: memberA, occurredAt: at })

test('Collection-first Library persists atomic filing, revision conflicts, replay, and ownership isolation', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-collection-first')
  try {
    const library = await import('../../dist/modules/library/index.js')
    const search = await import('../../dist/modules/search/index.js')
    const localSearch = new search.PostgresLocalSearch(database.pool)
    const readSummaries = async (placeIds) => (await localSearch.getCatalogPlaceDocuments(placeIds))
      .map((place) => ({
        placeId: place.placeId,
        name: place.name,
        areaLabel: place.area?.label ?? null,
        location: place.location,
        primaryTaxonomy: place.primaryTaxonomy === null
          ? null
          : { key: place.primaryTaxonomy.key, label: place.primaryTaxonomy.label },
        taxonomyKeys: place.taxonomyReferences.map((reference) => reference.key),
        evidence: { status: place.evidenceStatus, projectedAt: place.projectedAt },
      }))
    const workspace = new library.PostgresPersonalLibraryWorkspace(database.pool, readSummaries)
    const filing = new library.PostgresPlaceFiling(database.pool)
    const order = new library.PostgresCollectionOrder(database.pool)
    const lifecycle = new library.PostgresCollectionLifecycle(database.pool)

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','collection-first-a','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','collection-first-b','active','member','standard','unclassified',$3,$3)`,
      [memberA, memberB, at],
    )
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) VALUES ($1::uuid), ($2::uuid)',
      [placeA, placeB],
    )
    await search.projectLocalPlace({
      placeId: placeA, sourceVersion: 1, name: '서울 라멘', areaLabel: '서울 성동구',
      latitude: 37.5445, longitude: 127.056,
      primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
      taxonomyKeys: ['food.noodle.ramen'],
      taxonomyReferences: [{ key: 'food.noodle.ramen', version: 1, kind: 'category' }],
      evidenceStatus: 'verified', projectedAt: at,
    }, localSearch)
    await database.pool.query(
      `INSERT INTO search.place_documents (
         place_id, source_version, display_name, area_label, search_text, location,
         primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
         evidence_status, projected_at, taxonomy_references
       ) VALUES ($1::uuid,1,'좌표 확인 중인 카페','서울 중구','좌표 확인 중인 카페',NULL,
         'food.cafe','카페',ARRAY['food.cafe'],'unverified',$2::timestamptz,
         '[{"key":"food.cafe","version":1,"kind":"category"}]'::jsonb)`,
      [placeB, at],
    )

    const create = async (memberId, collectionId, name, operationId) => lifecycle.apply({
      kind: 'create', context: { operationId, memberId, occurredAt: at },
      collectionId, name, description: null,
    })
    const createdA = await create(
      memberA, collectionA, '서울 라멘', '01992d20-8000-7000-8000-000000000401',
    )
    const createdA2 = await create(
      memberA, collectionA2, '도쿄 여행', '01992d20-8000-7000-8000-000000000402',
    )
    await create(memberB, collectionB, '다른 사람 목록', '01992d20-8000-7000-8000-000000000403')
    assert.equal(createdA.status, 'applied')
    assert.equal(createdA2.status, 'applied')

    const firstWorkspacePage = await workspace.open({
      memberId: memberA,
      favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 1,
    })
    assert.equal(firstWorkspacePage.collections.items.length, 1)
    assert.ok(firstWorkspacePage.collections.nextCursor)
    const secondWorkspacePage = await workspace.open({
      memberId: memberA,
      favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'any' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 1,
      collectionCursor: firstWorkspacePage.collections.nextCursor,
    })
    assert.equal(secondWorkspacePage.collections.items.length, 1)
    assert.notEqual(
      firstWorkspacePage.collections.items[0].collectionId,
      secondWorkspacePage.collections.items[0].collectionId,
    )
    await assert.rejects(workspace.open({
      memberId: memberA,
      favoriteScope: { kind: 'all' }, ratingFilter: { kind: 'rated' },
      tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 1,
      collectionCursor: firstWorkspacePage.collections.nextCursor,
    }), library.InvalidLibraryCursorError)

    const choicesA = await filing.open({ memberId: memberA, placeId: placeA, limit: 50 })
    assert.equal(choicesA.collections.length, 2)
    const versions = new Map(choicesA.collections.map((choice) => [choice.collectionId, choice.version]))
    const mutation = {
      context: context('01992d20-8000-7000-8000-000000000410'),
      placeId: placeA,
      changes: [collectionA, collectionA2].map((collectionId) => ({
        collectionId, expectedVersion: versions.get(collectionId), desired: 'included',
      })),
    }
    const filed = await filing.apply(mutation)
    assert.equal(filed.status, 'applied')
    assert.equal(filed.value.collectionMembershipCount, 2)
    assert.equal((await database.pool.query(
      'SELECT count(*)::int AS count FROM library.place_preferences WHERE membership_id = $1::uuid',
      [memberA],
    )).rows[0].count, 0, 'filing must not write legacy saved/wanted preferences')
    const replay = await filing.apply({
      ...mutation,
      context: { ...mutation.context, occurredAt: '2026-09-03T01:00:00.000Z' },
    })
    assert.equal(replay.status, 'replayed')
    assert.deepEqual(replay.value, filed.value)
    const reused = await filing.apply({
      ...mutation,
      changes: [mutation.changes[0]],
    })
    assert.deepEqual(reused, {
      status: 'rejected', operationId: mutation.context.operationId,
      rejection: { code: 'operation-id-reused' },
    })

    const stale = await filing.apply({
      context: context('01992d20-8000-7000-8000-000000000411'),
      placeId: placeA,
      changes: [{
        collectionId: collectionA,
        expectedVersion: versions.get(collectionA),
        desired: 'excluded',
      }],
    })
    assert.deepEqual(stale.rejection, { code: 'version-conflict' })

    const foreign = await filing.apply({
      context: context('01992d20-8000-7000-8000-000000000412'),
      placeId: placeA,
      changes: [{
        collectionId: collectionB,
        expectedVersion: createdA.value.collection.version,
        desired: 'included',
      }],
    })
    assert.deepEqual(foreign.rejection, { code: 'not-found' })
    assert.doesNotMatch(JSON.stringify(foreign), new RegExp(collectionB))

    const currentB = await filing.open({ memberId: memberA, placeId: placeB, limit: 50 })
    const currentCollectionA = currentB.collections.find((choice) => choice.collectionId === collectionA)
    const filedB = await filing.apply({
      context: context('01992d20-8000-7000-8000-000000000413'),
      placeId: placeB,
      changes: [{
        collectionId: collectionA,
        expectedVersion: currentCollectionA.version,
        desired: 'included',
      }],
    })
    assert.equal(filedB.status, 'applied')

    const scoped = await workspace.open({
      memberId: memberA,
      favoriteScope: { kind: 'collection', collectionId: collectionA },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 50,
    })
    assert.deepEqual(scoped.favoritePlaces.items.map((item) => [
      item.placeId, item.place?.name, item.place?.location,
    ]), [
      [placeA, '서울 라멘', { latitude: 37.5445, longitude: 127.056 }],
      [placeB, '좌표 확인 중인 카페', null],
    ])
    assert.deepEqual(scoped.availableFilters.coverage, {
      favoritePlaceCount: 2, sampledPlaceCount: 2,
      projectedPlaceCount: 2, complete: true,
    })
    assert.deepEqual(scoped.availableFilters.areas.map((area) => area.label).sort(), [
      '서울 성동구', '서울 중구',
    ])
    assert.deepEqual(scoped.availableFilters.taxonomies.map((taxonomy) => taxonomy.key).sort(), [
      'food.cafe', 'food.noodle.ramen',
    ])
    const mapQueries = new library.PostgresLibraryQueries(
      database.pool,
      readSummaries,
      async (input) => {
        const read = await localSearch.getPlaceDocumentsInBounds(input.placeIds, input.bounds)
        return {
          places: await readSummaries(read.documents.map((place) => place.placeId)),
          unprojectedPlaceCount: read.unprojectedPlaceCount,
        }
      },
    )
    const map = await mapQueries.getMapProjection({
      memberId: memberA,
      scope: { kind: 'collection', collectionId: collectionA },
      bounds: { west: 126.9, south: 37.4, east: 127.2, north: 37.7 },
      zoom: 12,
    })
    assert.deepEqual(map.coverage, {
      representedPlaceCount: 1, unprojectedPlaceCount: 1, complete: false,
    })
    assert.deepEqual(map.features.map((feature) => feature.kind), ['place'])
    assert.equal(await workspace.open({
      memberId: memberA,
      favoriteScope: { kind: 'collection', collectionId: collectionB },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 20,
    }), undefined)

    const latestA = await filing.open({ memberId: memberA, placeId: placeA, limit: 50 })
    const latestVersion = latestA.collections.find((choice) => choice.collectionId === collectionA).version
    const moved = await order.move({
      context: context('01992d20-8000-7000-8000-000000000414'),
      collectionId: collectionA, placeId: placeB,
      expectedVersion: latestVersion, placement: { kind: 'first' },
    })
    assert.equal(moved.status, 'applied')
    assert.deepEqual((await database.pool.query(
      `SELECT canonical_place_id FROM library.collection_places
       WHERE collection_id = $1::uuid ORDER BY position`,
      [collectionA],
    )).rows.map((row) => row.canonical_place_id), [placeB, placeA])
  } finally {
    await database.close()
  }
})
