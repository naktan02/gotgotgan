import assert from 'node:assert/strict'
import test from 'node:test'

import {
  at, collectionA, collectionA2, collectionB, memberA, memberB, places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

test('Collection-first text search traverses owner pages and matches the independent map', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-workspace-search-map')
  try {
    const { database, library, seedCollections, command } = fixture
    await seedCollections()
    const ids = Array.from({ length: 505 }, (_, index) => `01992d20-3000-7000-8000-${String(10_000 + index).padStart(12, '0')}`)
    const targetId = ids.at(-1)
    await database.pool.query('INSERT INTO places.canonical_places (id) SELECT unnest($1::uuid[])', [ids])
    await database.pool.query(
      `INSERT INTO library.collection_places (collection_id, canonical_place_id, position, added_at)
       SELECT $1::uuid, place_id, ordinal::integer + 2, $3::timestamptz
       FROM unnest($2::uuid[]) WITH ORDINALITY AS item(place_id, ordinal)`, [collectionA, ids, at],
    )
    const summaries = new Map([...places.slice(0, 2), ...ids].map((placeId) => [placeId, {
      placeId, name: placeId === targetId ? '쇼유 전문점' : '장소',
      areaLabel: placeId === targetId ? '서울 성동구 성수동' : '서울 중구',
      location: { latitude: 37.54, longitude: 127.05 },
      primaryTaxonomy: { key: 'food.ramen', label: '라멘' }, taxonomyKeys: ['food.ramen'],
      evidence: { status: 'unverified', projectedAt: at },
    }]))
    const batches = []
    const workspace = new library.PostgresPersonalLibraryWorkspace(database.pool, async (placeIds) => {
      batches.push(placeIds.length)
      return placeIds.flatMap((placeId) => summaries.has(placeId) ? [summaries.get(placeId)] : [])
    })
    const base = {
      memberId: memberA, favoriteScope: { kind: 'collection', collectionId: collectionA },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
    }
    const first = await workspace.open({ ...base, placeQuery: ' 성수동   라멘 ' })
    assert.equal(first.favoritePlaces.items.length, 0)
    assert.ok(first.favoritePlaces.nextCursor, 'empty bounded scan must remain traversable')
    const next = await workspace.open({ ...base, placeQuery: '성수동 라멘', placeCursor: first.favoritePlaces.nextCursor })
    assert.deepEqual(next.favoritePlaces.items.map((row) => row.placeId), [targetId])
    assert.equal(next.favoritePlaces.nextCursor, undefined)
    await assert.rejects(workspace.open({ ...base, placeQuery: '중구 라멘', placeCursor: first.favoritePlaces.nextCursor }), library.InvalidLibraryCursorError)
    await assert.rejects(workspace.open({ ...base, memberId: memberB, favoriteScope: { kind: 'all' }, placeQuery: '성수동 라멘', placeCursor: first.favoritePlaces.nextCursor }), library.InvalidLibraryCursorError)

    const directoryFirst = await workspace.open({ ...base, favoriteScope: { kind: 'all' }, limit: 1 })
    assert.equal(directoryFirst.collections.items[0].collectionId, collectionA)
    const directorySearch = await workspace.open({ ...base, collectionQuery: '을지로' })
    assert.deepEqual(directorySearch.collections.items.map((row) => row.collectionId), [collectionA2])
    assert.equal(directorySearch.selectedCollection, undefined, 'existing requests do not receive a new strict-response field')
    const selectedMetadata = await workspace.open({ ...base, collectionQuery: '을지로', includeSelectedCollection: true })
    assert.equal(selectedMetadata.selectedCollection.collectionId, collectionA)
    assert.equal(selectedMetadata.selectedCollection.placeCount, 508)
    assert.ok(selectedMetadata.selectedCollection.version)
    assert.equal((await workspace.open({ ...base, favoriteScope: { kind: 'all' }, includeSelectedCollection: true })).selectedCollection, undefined)
    await assert.rejects(workspace.open({ ...base, favoriteScope: { kind: 'all' }, collectionQuery: '성수', collectionCursor: directoryFirst.collections.nextCursor }), library.InvalidLibraryCursorError)
    assert.equal((await workspace.open({ ...base, collectionQuery: '%' })).collections.items.length, 0, 'SQL wildcard is literal text')
    assert.equal(await workspace.open({ ...base, favoriteScope: { kind: 'collection', collectionId: collectionB } }), undefined)
    assert.equal((await workspace.open({ ...base, favoriteScope: { kind: 'collection', collectionId: collectionA2 } })).availableFilters.coverage.favoritePlaceCount, 0)

    const ownTagId = '01992d20-3000-7000-8000-000000000701'
    const otherTagId = '01992d20-3000-7000-8000-000000000702'
    for (const [index, [memberId, tagId, name, placeId]] of [
      [memberA, ownTagId, '혼밥', targetId], [memberB, otherTagId, '비밀분류', targetId],
    ].entries()) {
      await command(`01992d20-3000-7000-8000-000000000${710 + index * 2}`, memberId, { kind: 'create-tag', tagId, name })
      await command(`01992d20-3000-7000-8000-000000000${711 + index * 2}`, memberId, { kind: 'tag-place', tagId, placeId })
    }
    let tagPage = await workspace.open({ ...base, placeQuery: '성수동 혼밥' })
    tagPage = await workspace.open({ ...base, placeQuery: '성수동 혼밥', placeCursor: tagPage.favoritePlaces.nextCursor })
    assert.deepEqual(tagPage.favoritePlaces.items.map((row) => row.placeId), [targetId])
    const scope = { ...base, placeQuery: '성수동 혼밥', tagIds: [ownTagId], bounds: { west: -180, south: -85, east: 180, north: 85 }, zoom: 2 }
    batches.length = 0
    const map = await workspace.openMap(scope)
    assert.equal(map.schemaVersion, 'personal-library-map.v2')
    assert.equal(map.coverage.representedPlaceCount, 1)
    assert.equal(map.features[0].placeId, targetId)
    assert.ok(batches.every((count) => count <= 500), 'map summary reads are bounded independently of scope size')
    const areaKey = first.availableFilters.areas.find((facet) => facet.label === '서울 성동구 성수동').key
    const filtered = { ...scope, areaKeys: [areaKey], taxonomyKeys: ['food.ramen'], ratingFilter: { kind: 'unrated' } }
    assert.deepEqual((await workspace.open(filtered)).favoritePlaces.items.map((row) => row.placeId), [targetId])
    assert.equal((await workspace.openMap(filtered)).coverage.representedPlaceCount, 1)
    const foreignTagMap = await workspace.openMap({ ...scope, placeQuery: '비밀분류', tagIds: [] })
    assert.equal(foreignTagMap.coverage.representedPlaceCount, 0)
    const mismatchMap = await workspace.openMap({ ...scope, taxonomyKeys: ['food.cafe'] })
    assert.equal(mismatchMap.coverage.representedPlaceCount, 0)
    const ratedMap = await workspace.openMap({ ...scope, ratingFilter: { kind: 'rated' } })
    assert.equal(ratedMap.coverage.representedPlaceCount, 0)
    assert.equal(await workspace.openMap({ ...scope, favoriteScope: { kind: 'collection', collectionId: collectionB } }), undefined)
    const fullMap = await workspace.openMap({ ...scope, placeQuery: '', tagIds: [] })
    assert.equal(fullMap.coverage.representedPlaceCount, 507)
    assert.equal(fullMap.coverage.unprojectedPlaceCount, 1)
    assert.equal(fullMap.features[0].count, 507)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(workspace.openMap(scope, controller.signal), { name: 'AbortError' })
    const duringRead = new AbortController()
    let readCount = 0
    const cancellable = new library.PostgresPersonalLibraryWorkspace(database.pool, async () => {
      readCount += 1
      duringRead.abort()
      return []
    })
    await assert.rejects(cancellable.openMap({ ...scope, tagIds: [], placeQuery: '' }, duringRead.signal), { name: 'AbortError' })
    assert.equal(readCount, 1, 'cancelled map must not scan the next owner page')
  } finally {
    await fixture.close()
  }
})
