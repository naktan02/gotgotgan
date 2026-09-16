import assert from 'node:assert/strict'
import test from 'node:test'

import {
  memberA,
  memberB,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

test('place facets, filtered pages, and map projections isolate members', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-library-facets-map')
  try {
    const { library, queries } = fixture
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
      areaKeys: [], taxonomyKeys: [], limit: 1, cursor: savedFirst.nextCursor,
    })
    assert.deepEqual(savedSecond.items.map((item) => item.placeId), [places[1]])
    assert.equal(savedSecond.nextCursor, undefined)
    await assert.rejects(
      queries.listPlaces({
        memberId: memberA, state: 'wanted', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [], limit: 20, cursor: savedFirst.nextCursor,
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
  } finally {
    await fixture.close()
  }
})
