import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectionA,
  collectionA2,
  collectionB,
  memberA,
  memberB,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

const tagOne = '01992d20-3000-7000-8000-000000000601'
const tagTwo = '01992d20-3000-7000-8000-000000000602'

test('tag filters and place organization paginate without crossing member boundaries', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-library-tag-organization')
  try {
    const { command, library, queries, seedCollections } = fixture
    await seedCollections()
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
    await command('01992d20-3000-7000-8000-000000000529', memberA, {
      kind: 'add-collection-place', collectionId: collectionA, placeId: places[0],
    })
    await command('01992d20-3000-7000-8000-000000000523', memberA, {
      kind: 'delete-collection', collectionId: collectionA2,
    })
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
  } finally {
    await fixture.close()
  }
})
