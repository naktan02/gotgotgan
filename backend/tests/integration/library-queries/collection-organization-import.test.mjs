import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectionA,
  collectionA2,
  collectionB,
  memberA,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

test('collection organization and imported provenance remain owner-scoped', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-library-collection-organization')
  try {
    const {
      command,
      database,
      library,
      libraryStore,
      queries,
      seedCollections,
    } = fixture
    await seedCollections()

    const collectionsFirst = await queries.listCollections({ memberId: memberA, limit: 1 })
    assert.deepEqual(collectionsFirst.items.map((item) => item.collectionId), [collectionA])
    assert.equal(collectionsFirst.items[0].placeCount, 3)
    const collectionsSecond = await queries.listCollections({
      memberId: memberA, limit: 1, cursor: collectionsFirst.nextCursor,
    })
    assert.deepEqual(collectionsSecond.items.map((item) => item.collectionId), [collectionA2])
    assert.equal(await queries.getCollection({
      memberId: memberA, collectionId: collectionB, limit: 20,
    }), undefined)

    const detailFirst = await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 2,
    })
    assert.deepEqual(detailFirst.places.map((item) => item.position), [0, 1])
    assert.ok(detailFirst.nextCursor)
    const detailSecond = await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 2, cursor: detailFirst.nextCursor,
    })
    assert.deepEqual(detailSecond.places.map((item) => item.position), [2])
    assert.equal(detailSecond.places[0].place, null)
    await assert.rejects(
      queries.getCollection({
        memberId: memberA, collectionId: collectionA2,
        limit: 20, cursor: detailFirst.nextCursor,
      }),
      library.InvalidLibraryCursorError,
    )
    await command('01992d20-3000-7000-8000-000000000520', memberA, {
      kind: 'move-collection-place', collectionId: collectionA,
      placeId: places[2], position: 0,
    }, '2026-08-28T06:00:00.000Z')
    await command('01992d20-3000-7000-8000-000000000521', memberA, {
      kind: 'remove-collection-place', collectionId: collectionA, placeId: places[0],
    }, '2026-08-28T06:01:00.000Z')
    await command('01992d20-3000-7000-8000-000000000522', memberA, {
      kind: 'rename-collection', collectionId: collectionA, name: '성수 라멘',
    }, '2026-08-28T06:02:00.000Z')
    const organizedCollection = await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 20,
    })
    assert.equal(organizedCollection.collection.name, '성수 라멘')
    assert.deepEqual(
      organizedCollection.places.map((item) => [item.placeId, item.position]),
      [[places[2], 0], [places[1], 2]],
    )
    await command('01992d20-3000-7000-8000-000000000529', memberA, {
      kind: 'add-collection-place', collectionId: collectionA, placeId: places[0],
    })
    assert.deepEqual((await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 20,
    })).places.map((item) => [item.placeId, item.position]), [
      [places[2], 0], [places[1], 2], [places[0], 3],
    ])
    await command('01992d20-3000-7000-8000-000000000523', memberA, {
      kind: 'delete-collection', collectionId: collectionA2,
    })
    assert.equal(await queries.getCollection({
      memberId: memberA, collectionId: collectionA2, limit: 20,
    }), undefined)

    const importedSource = {
      providerKey: 'naver',
      connectionId: '01992d20-3000-7000-8000-000000000524',
      listId: 'ramen-list',
      itemId: 'ramen-place',
      providerPlaceId: 'naver-ramen-place',
      listName: '가져온 라멘',
      listPosition: 0,
      position: 0,
    }
    await library.saveImportedPlace({
      commandId: '01992d20-3000-7000-8000-000000000525',
      memberId: memberA,
      canonicalPlaceId: places[3],
      occurredAt: '2026-08-28T06:03:00.000Z',
      source: importedSource,
      store: libraryStore,
    })
    const firstImportedPreferenceVersion = (await database.pool.query(
      `SELECT updated_at FROM library.place_preferences
       WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid`,
      [memberA, places[3]],
    )).rows[0].updated_at
    const importedCollection = await database.pool.query(
      `SELECT collection_id FROM library.collection_import_provenance
       WHERE owner_membership_id = $1::uuid AND source_list_id = $2`,
      [memberA, importedSource.listId],
    )
    const importedCollectionId = importedCollection.rows[0].collection_id
    await command('01992d20-3000-7000-8000-000000000526', memberA, {
      kind: 'remove-collection-place',
      collectionId: importedCollectionId,
      placeId: places[3],
    })
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count FROM library.collection_place_import_provenance
       WHERE collection_id = $1::uuid`,
      [importedCollectionId],
    )).rows[0].count, 0)
    await library.saveImportedPlace({
      commandId: '01992d20-3000-7000-8000-000000000527',
      memberId: memberA,
      canonicalPlaceId: places[3],
      occurredAt: '2026-08-28T06:03:00.000Z',
      source: importedSource,
      store: libraryStore,
    })
    const secondImportedPreferenceVersion = (await database.pool.query(
      `SELECT updated_at FROM library.place_preferences
       WHERE membership_id = $1::uuid AND canonical_place_id = $2::uuid`,
      [memberA, places[3]],
    )).rows[0].updated_at
    assert.equal(
      secondImportedPreferenceVersion.getTime(),
      firstImportedPreferenceVersion.getTime() + 1,
    )
    await command('01992d20-3000-7000-8000-000000000528', memberA, {
      kind: 'delete-collection', collectionId: importedCollectionId,
    })
    assert.equal((await database.pool.query(
      `SELECT count(*)::int AS count FROM library.collection_import_provenance
       WHERE collection_id = $1::uuid`,
      [importedCollectionId],
    )).rows[0].count, 0)
  } finally {
    await fixture.close()
  }
})
