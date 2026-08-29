import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const memberA = '01992d20-3000-7000-8000-000000000101'
const memberB = '01992d20-3000-7000-8000-000000000102'
const places = [
  '01992d20-3000-7000-8000-000000000201',
  '01992d20-3000-7000-8000-000000000202',
  '01992d20-3000-7000-8000-000000000203',
  '01992d20-3000-7000-8000-000000000204',
]
const collectionA = '01992d20-3000-7000-8000-000000000301'
const collectionA2 = '01992d20-3000-7000-8000-000000000302'
const collectionB = '01992d20-3000-7000-8000-000000000303'
const at = '2026-08-28T00:00:00.000Z'

test('bounded Library queries paginate, hydrate public Place facts, and isolate members', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-library-queries')
  try {
    const library = await import('../../dist/modules/library/index.js')
    const search = await import('../../dist/modules/search/index.js')
    const libraryStore = new library.PostgresLibraryStore(database.pool)
    const localSearch = new search.PostgresLocalSearch(database.pool)
    const summaryBatches = []
    const toSummary = (document) => ({
      placeId: document.placeId,
      name: document.name,
      areaLabel: document.areaLabel,
      location: { latitude: document.latitude, longitude: document.longitude },
      primaryTaxonomy: document.primaryTaxonomy,
      taxonomyKeys: document.taxonomyKeys,
      evidence: { status: document.evidenceStatus, projectedAt: document.projectedAt },
    })
    const queries = new library.PostgresLibraryQueries(database.pool, async (placeIds) => {
      summaryBatches.push([...placeIds])
      return (await localSearch.getPlaceDocuments(placeIds)).map(toSummary)
    }, async (input) => {
      const read = await localSearch.getPlaceDocumentsInBounds(input.placeIds, input.bounds)
      return {
        places: read.documents.map(toSummary),
        unprojectedPlaceCount: read.unprojectedPlaceCount,
      }
    })

    await database.pool.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
        ($1,'https://identity.example.test','library-a','active','member','standard','unclassified',$3,$3),
        ($2,'https://identity.example.test','library-b','active','member','standard','unclassified',$3,$3)`,
      [memberA, memberB, at],
    )
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) SELECT unnest($1::uuid[])',
      [places],
    )
    for (const [index, placeId] of places.slice(0, 2).entries()) {
      await search.projectLocalPlace({
        placeId,
        sourceVersion: 1,
        name: `성수 장소 ${index + 1}`,
        areaLabel: index === 0 ? '서울 성동구 성수동' : '서울 중구 을지로',
        latitude: 37.5445,
        longitude: 127.056 + index * 0.001,
        primaryTaxonomy: index === 0
          ? { key: 'food.noodle.ramen', label: '라멘' }
          : { key: 'food.cafe', label: '카페' },
        taxonomyKeys: [index === 0 ? 'food.noodle.ramen' : 'food.cafe'],
        evidenceStatus: 'verified',
        projectedAt: at,
      }, localSearch)
    }

    const preference = (commandId, memberId, placeId, saved, wanted, personalRating, occurredAt) => (
      library.applyLibraryCommand({
        commandId, memberId, occurredAt,
        command: {
          kind: 'set-place-preferences', placeId, expectedUpdatedAt: null,
          saved, wanted, personalRating,
        },
        store: libraryStore,
      })
    )
    await preference('01992d20-3000-7000-8000-000000000401', memberA, places[0], true, false, 4.4, '2026-08-28T03:00:00.000Z')
    await preference('01992d20-3000-7000-8000-000000000402', memberA, places[1], true, true, null, '2026-08-28T02:00:00.000Z')
    await preference('01992d20-3000-7000-8000-000000000403', memberA, places[2], false, true, 3.5, '2026-08-28T01:00:00.000Z')
    await preference('01992d20-3000-7000-8000-000000000404', memberB, places[3], true, true, 5, '2026-08-28T04:00:00.000Z')

    const facets = await queries.getPlaceFacets({ memberId: memberA })
    assert.deepEqual(facets.coverage, {
      savedPlaceCount: 2, sampledPlaceCount: 2, projectedPlaceCount: 2, complete: true,
    })
    assert.deepEqual(facets.areas.map((facet) => [facet.label, facet.count]).sort(), [
      ['서울 성동구 성수동', 1], ['서울 중구 을지로', 1],
    ].sort())
    assert.deepEqual(facets.taxonomies.map((facet) => [facet.key, facet.count]), [
      ['food.cafe', 1], ['food.noodle.ramen', 1],
    ])
    assert.deepEqual((await queries.getPlaceFacets({ memberId: memberB })).coverage, {
      savedPlaceCount: 1, sampledPlaceCount: 1, projectedPlaceCount: 0, complete: true,
    })

    const seongsuAreaKey = facets.areas.find((facet) => facet.label === '서울 성동구 성수동').key
    const ramenOnly = await queries.listPlaces({
      memberId: memberA, state: 'saved', tagIds: [], tagMatch: 'all',
      areaKeys: [seongsuAreaKey], taxonomyKeys: ['food.noodle.ramen'], limit: 20,
    })
    assert.deepEqual(ramenOnly.items.map((item) => item.placeId), [places[0]])
    assert.deepEqual(ramenOnly.filter.areaKeys, [seongsuAreaKey])

    const savedFirst = await queries.listPlaces({
      memberId: memberA, state: 'saved', tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 1,
    })
    assert.deepEqual(savedFirst.items.map((item) => item.placeId), [places[0]])
    assert.equal(savedFirst.items[0].place.name, '성수 장소 1')
    assert.ok(savedFirst.nextCursor)
    const savedMap = await queries.getMapProjection({
      memberId: memberA,
      scope: {
        kind: 'state', state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [],
      },
      bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      zoom: 12,
    })
    assert.equal(savedMap.coverage.representedPlaceCount, 2)
    assert.equal(savedMap.coverage.complete, true)
    assert.equal(savedMap.features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0), 2)
    const unprojectedMemberMap = await queries.getMapProjection({
      memberId: memberB,
      scope: {
        kind: 'state', state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [],
      },
      bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      zoom: 12,
    })
    assert.deepEqual(unprojectedMemberMap.coverage, {
      representedPlaceCount: 0, unprojectedPlaceCount: 1, complete: false,
    })
    await assert.rejects(
      queries.listPlaces({
        memberId: memberA, state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [seongsuAreaKey], taxonomyKeys: [],
        limit: 20, cursor: savedFirst.nextCursor,
      }),
      library.InvalidLibraryCursorError,
    )
    const savedSecond = await queries.listPlaces({
      memberId: memberA, state: 'saved', tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [],
      limit: 1, cursor: savedFirst.nextCursor,
    })
    assert.deepEqual(savedSecond.items.map((item) => item.placeId), [places[1]])
    assert.equal(savedSecond.nextCursor, undefined)
    await assert.rejects(
      queries.listPlaces({
        memberId: memberA, state: 'wanted', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [],
        limit: 20, cursor: savedFirst.nextCursor,
      }),
      library.InvalidLibraryCursorError,
    )
    const rated = await queries.listPlaces({
      memberId: memberA, state: 'rated', tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 20,
    })
    assert.deepEqual(rated.items.map((item) => item.placeId), [places[0], places[2]])
    assert.equal(rated.items[1].place, null)
    assert.doesNotMatch(JSON.stringify(rated), new RegExp(memberB))
    assert.doesNotMatch(JSON.stringify(rated), new RegExp(places[3]))
    await assert.rejects(
      queries.listPlaces({
        memberId: memberA, state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [], limit: 51,
      }),
      library.InvalidLibraryQueryError,
    )

    const command = (commandId, memberId, value, occurredAt = at) => library.applyLibraryCommand({
      commandId, memberId, command: value, occurredAt, store: libraryStore,
    })
    await command('01992d20-3000-7000-8000-000000000501', memberA, {
      kind: 'create-collection', collectionId: collectionA,
      name: '성수',
    }, '2026-08-28T05:00:00.000Z')
    await command('01992d20-3000-7000-8000-000000000502', memberA, {
      kind: 'create-collection', collectionId: collectionA2,
      name: '을지로',
    }, '2026-08-28T04:00:00.000Z')
    await command('01992d20-3000-7000-8000-000000000503', memberB, {
      kind: 'create-collection', collectionId: collectionB,
      name: '비공개',
    })
    for (const [index, placeId] of places.slice(0, 3).entries()) {
      await command(`01992d20-3000-7000-8000-${String(510 + index).padStart(12, '0')}`, memberA, {
        kind: 'add-collection-place', collectionId: collectionA, placeId, position: index,
      })
    }

    const publishableCollection = await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 20,
    })
    await command('01992d20-3000-7000-8000-000000000530', memberA, {
      kind: 'set-collection-publication',
      collectionId: collectionA,
      expectedUpdatedAt: publishableCollection.collection.updatedAt,
      visibility: 'unlisted',
    })
    const publishedCollectionId = (await queries.getCollection({
      memberId: memberA, collectionId: collectionA, limit: 20,
    })).collection.publicationId
    assert.ok(publishedCollectionId)
    summaryBatches.length = 0
    const publishedFirst = await queries.getPublishedCollection({
      publicationId: publishedCollectionId, limit: 1,
    })
    assert.equal(publishedFirst.placeCount, 3)
    assert.ok(publishedFirst.nextCursor)
    assert.deepEqual(summaryBatches, [[places[0]]])
    const publishedSecond = await queries.getPublishedCollection({
      publicationId: publishedCollectionId, limit: 2, cursor: publishedFirst.nextCursor,
    })
    assert.deepEqual(summaryBatches, [[places[0]], [places[1], places[2]]])
    const publishedPlaces = [...publishedFirst.places, ...publishedSecond.places]
    assert.deepEqual(publishedPlaces.map((item) => [
      item.placeId,
      item.position,
      item.place?.name ?? null,
    ]), [
      [places[0], 0, '성수 장소 1'],
      [places[1], 1, '성수 장소 2'],
      [places[2], 2, null],
    ])
    assert.equal(publishedSecond.nextCursor, undefined)
    const publishedMap = await queries.getPublishedCollectionMap({
      publicationId: publishedCollectionId,
      bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 },
      zoom: 12,
    })
    assert.deepEqual(publishedMap.coverage, {
      representedPlaceCount: 2, unprojectedPlaceCount: 1, complete: false,
    })
    assert.equal(await queries.getPublishedCollection({
      publicationId: collectionB, limit: 50,
    }), undefined)

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

    const tagOne = '01992d20-3000-7000-8000-000000000601'
    const tagTwo = '01992d20-3000-7000-8000-000000000602'
    await command('01992d20-3000-7000-8000-000000000603', memberA, {
      kind: 'create-tag', tagId: tagOne, name: '혼밥',
    })
    await command('01992d20-3000-7000-8000-000000000604', memberA, {
      kind: 'create-tag', tagId: tagTwo, name: '데이트',
    })
    for (const [index, placeId] of places.slice(0, 2).entries()) {
      await command(`01992d20-3000-7000-8000-${String(610 + index).padStart(12, '0')}`, memberA, {
        kind: 'tag-place', tagId: tagOne, placeId,
      })
    }
    for (const [index, placeId] of places.slice(1, 3).entries()) {
      await command(`01992d20-3000-7000-8000-${String(612 + index).padStart(12, '0')}`, memberA, {
        kind: 'tag-place', tagId: tagTwo, placeId,
      })
    }
    const tags = await queries.listTags({ memberId: memberA, limit: 20 })
    assert.deepEqual(tags.items.map((item) => [item.name, item.placeCount]), [
      ['데이트', 2], ['혼밥', 2],
    ])

    const organizationFirst = await queries.getPlaceOrganization({
      memberId: memberA, placeId: places[1], limit: 2,
    })
    assert.deepEqual(organizationFirst.items, [{
      kind: 'collection', collectionId: collectionA, name: '성수 라멘',
      selected: true, position: 2,
    }, {
      kind: 'tag', tagId: tagTwo, name: '데이트', selected: true,
    }])
    assert.ok(organizationFirst.nextCursor)
    const organizationSecond = await queries.getPlaceOrganization({
      memberId: memberA,
      placeId: places[1],
      limit: 2,
      cursor: organizationFirst.nextCursor,
    })
    assert.deepEqual(organizationSecond.items, [{
      kind: 'tag', tagId: tagOne, name: '혼밥', selected: true,
    }])
    assert.equal(organizationSecond.nextCursor, undefined)
    assert.deepEqual((await queries.getPlaceOrganization({
      memberId: memberB, placeId: places[1], limit: 20,
    })).items, [{
      kind: 'collection', collectionId: collectionB, name: '비공개',
      selected: false, position: null,
    }])
    await assert.rejects(
      queries.getPlaceOrganization({
        memberId: memberA,
        placeId: places[0],
        limit: 20,
        cursor: organizationFirst.nextCursor,
      }),
      library.InvalidLibraryCursorError,
    )

    const allTags = await queries.listPlaces({
      memberId: memberA,
      state: 'saved',
      tagIds: [tagTwo, tagOne],
      tagMatch: 'all',
      areaKeys: [],
      taxonomyKeys: [],
      limit: 20,
    })
    assert.deepEqual(allTags.filter, {
      state: 'saved', tagIds: [tagOne, tagTwo], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [],
    })
    assert.deepEqual(allTags.items.map((item) => item.placeId), [places[1]])
    const anyTagsFirst = await queries.listPlaces({
      memberId: memberA,
      state: 'saved',
      tagIds: [tagOne, tagTwo],
      tagMatch: 'any',
      areaKeys: [],
      taxonomyKeys: [],
      limit: 1,
    })
    assert.deepEqual(anyTagsFirst.items.map((item) => item.placeId), [places[0]])
    assert.ok(anyTagsFirst.nextCursor)
    const anyTagsSecond = await queries.listPlaces({
      memberId: memberA,
      state: 'saved',
      tagIds: [tagOne, tagTwo],
      tagMatch: 'any',
      areaKeys: [],
      taxonomyKeys: [],
      limit: 1,
      cursor: anyTagsFirst.nextCursor,
    })
    assert.deepEqual(anyTagsSecond.items.map((item) => item.placeId), [places[1]])
    await assert.rejects(
      queries.listPlaces({
        memberId: memberA,
        state: 'saved',
        tagIds: [tagOne, tagTwo],
        tagMatch: 'all',
        areaKeys: [],
        taxonomyKeys: [],
        limit: 1,
        cursor: anyTagsFirst.nextCursor,
      }),
      library.InvalidLibraryCursorError,
    )
    await command('01992d20-3000-7000-8000-000000000620', memberA, {
      kind: 'rename-tag', tagId: tagTwo, name: '쇼유라멘',
    })
    await command('01992d20-3000-7000-8000-000000000621', memberA, {
      kind: 'untag-place', tagId: tagTwo, placeId: places[1],
    })
    await command('01992d20-3000-7000-8000-000000000622', memberA, {
      kind: 'delete-tag', tagId: tagOne,
    })
    const editedTags = await queries.listTags({ memberId: memberA, limit: 20 })
    assert.deepEqual(editedTags.items.map((item) => [item.name, item.placeCount]), [
      ['쇼유라멘', 1],
    ])

    await database.pool.query(`
      WITH generated AS (
        SELECT
          (substr(md5(sequence::text), 1, 8) || '-' || substr(md5(sequence::text), 9, 4) || '-4' ||
           substr(md5(sequence::text), 14, 3) || '-8' || substr(md5(sequence::text), 18, 3) || '-' ||
           substr(md5(sequence::text), 21, 12))::uuid AS id,
          sequence
        FROM generate_series(1000, 5999) AS sequence
      ), inserted AS (
        INSERT INTO places.canonical_places (id)
        SELECT id FROM generated ON CONFLICT (id) DO NOTHING RETURNING id
      )
      INSERT INTO library.place_preferences (
        membership_id, canonical_place_id, saved, wanted, personal_rating, created_at, updated_at
      )
      SELECT $1::uuid, id, true, false, NULL, '2026-01-01T00:00:00Z',
             '2026-01-01T00:00:00Z'::timestamptz + (sequence || ' seconds')::interval
      FROM generated
      ON CONFLICT (membership_id, canonical_place_id) DO NOTHING
    `, [memberA])
    await database.pool.query('ANALYZE library.place_preferences')
    await database.pool.query('SET enable_seqscan = off')
    const plan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT canonical_place_id FROM library.place_preferences
      WHERE membership_id = $1::uuid AND saved
      ORDER BY updated_at DESC, canonical_place_id ASC LIMIT 20
    `, [memberA])
    assert.match(JSON.stringify(plan.rows[0]), /library_place_preferences_saved_updated/)
    const tagPlan = await database.pool.query(`
      EXPLAIN (FORMAT JSON)
      SELECT canonical_place_id FROM library.place_tags
      WHERE membership_id = $1::uuid AND tag_id = $2::uuid
      ORDER BY canonical_place_id LIMIT 20
    `, [memberA, tagTwo])
    assert.match(JSON.stringify(tagPlan.rows[0]), /library_place_tags_member_tag_place/)
  } finally {
    await database.close()
  }
})
