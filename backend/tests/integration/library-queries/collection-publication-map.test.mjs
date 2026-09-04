import assert from 'node:assert/strict'
import test from 'node:test'

import {
  at,
  collectionA,
  collectionB,
  memberA,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

test('published collection pages and maps preserve coverage across the dateline', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-library-publication-map')
  try {
    const {
      command,
      database,
      localSearch,
      queries,
      search,
      seedCollections,
      summaryBatches,
    } = fixture
    await seedCollections()

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

    const datelinePlaces = [
      ['01992d20-3000-7000-8000-000000000205', 1, 179.1],
      ['01992d20-3000-7000-8000-000000000206', 1.01, 179.11],
      ['01992d20-3000-7000-8000-000000000207', 2, -179.1],
    ]
    await database.pool.query(
      'INSERT INTO places.canonical_places (id) SELECT unnest($1::uuid[])',
      [datelinePlaces.map(([placeId]) => placeId)],
    )
    for (const [index, [placeId, latitude, longitude]] of datelinePlaces.entries()) {
      await search.projectLocalPlace({
        placeId,
        sourceVersion: 1,
        name: `날짜변경선 장소 ${index + 1}`,
        areaLabel: '날짜변경선',
        latitude,
        longitude,
        primaryTaxonomy: { key: 'tourism.attraction', label: '관광지' },
        taxonomyKeys: ['tourism.attraction'],
        evidenceStatus: 'verified',
        projectedAt: at,
      }, localSearch)
      await command(`01992d20-3000-7000-8000-${String(540 + index).padStart(12, '0')}`, memberA, {
        kind: 'add-collection-place', collectionId: collectionA, placeId, position: 3 + index,
      }, `2026-08-28T07:0${index}:00.000Z`)
    }
    const crossingBounds = { west: 170, south: -10, east: -170, north: 10 }
    const ownerCrossingMap = await queries.getMapProjection({
      memberId: memberA,
      scope: { kind: 'collection', collectionId: collectionA },
      bounds: crossingBounds,
      zoom: 12.5,
    })
    assert.equal(ownerCrossingMap.viewport.zoom, 12.5)
    assert.equal(ownerCrossingMap.coverage.representedPlaceCount, 3)
    assert.equal(ownerCrossingMap.features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0), 3)
    assert.deepEqual(ownerCrossingMap.features.map((feature) => feature.kind).sort(), [
      'cluster', 'place',
    ])
    assert.match(
      ownerCrossingMap.features.find((feature) => feature.kind === 'cluster').clusterId,
      /^z12-/,
    )
    const publicCrossingMap = await queries.getPublishedCollectionMap({
      publicationId: publishedCollectionId,
      bounds: crossingBounds,
      zoom: 12.5,
    })
    assert.equal(publicCrossingMap.coverage.representedPlaceCount, 3)
    assert.equal(publicCrossingMap.features.reduce((count, feature) => (
      count + (feature.kind === 'place' ? 1 : feature.count)
    ), 0), 3)
    for (const [index, [placeId]] of datelinePlaces.entries()) {
      await command(
        `01992d20-3000-7000-8000-${String(550 + index).padStart(12, '0')}`,
        memberA,
        { kind: 'remove-collection-place', collectionId: collectionA, placeId },
        `2026-08-28T07:1${index}:00.000Z`,
      )
    }
    assert.equal(await queries.getPublishedCollection({
      publicationId: collectionB, limit: 50,
    }), undefined)
  } finally {
    await fixture.close()
  }
})
