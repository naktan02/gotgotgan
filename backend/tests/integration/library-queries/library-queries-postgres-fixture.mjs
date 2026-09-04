import { startPreparedPlaceDatabase } from '../support/prepared-place-database.mjs'

export const memberA = '01992d20-3000-7000-8000-000000000101'
export const memberB = '01992d20-3000-7000-8000-000000000102'
export const places = [
  '01992d20-3000-7000-8000-000000000201',
  '01992d20-3000-7000-8000-000000000202',
  '01992d20-3000-7000-8000-000000000203',
  '01992d20-3000-7000-8000-000000000204',
]
export const collectionA = '01992d20-3000-7000-8000-000000000301'
export const collectionA2 = '01992d20-3000-7000-8000-000000000302'
export const collectionB = '01992d20-3000-7000-8000-000000000303'
export const at = '2026-08-28T00:00:00.000Z'

export async function startLibraryQueriesPostgresFixture(name) {
  const database = await startPreparedPlaceDatabase(name)
  const library = await import('../../../dist/modules/library/index.js')
  const search = await import('../../../dist/modules/search/index.js')
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

  const command = (commandId, memberId, value, occurredAt = at) => library.applyLibraryCommand({
    commandId, memberId, command: value, occurredAt, store: libraryStore,
  })
  const preference = (commandId, memberId, placeId, saved, wanted, personalRating, occurredAt) => (
    command(commandId, memberId, {
      kind: 'set-place-preferences', placeId, expectedUpdatedAt: null,
      saved, wanted, personalRating,
    }, occurredAt)
  )
  await preference('01992d20-3000-7000-8000-000000000401', memberA, places[0], true, false, 4.4, '2026-08-28T03:00:00.000Z')
  await preference('01992d20-3000-7000-8000-000000000402', memberA, places[1], true, true, null, '2026-08-28T02:00:00.000Z')
  await preference('01992d20-3000-7000-8000-000000000403', memberA, places[2], false, true, 3.5, '2026-08-28T01:00:00.000Z')
  await preference('01992d20-3000-7000-8000-000000000404', memberB, places[3], true, true, 5, '2026-08-28T04:00:00.000Z')

  async function seedCollections() {
    await command('01992d20-3000-7000-8000-000000000501', memberA, {
      kind: 'create-collection', collectionId: collectionA, name: '성수',
    }, '2026-08-28T05:00:00.000Z')
    await command('01992d20-3000-7000-8000-000000000502', memberA, {
      kind: 'create-collection', collectionId: collectionA2, name: '을지로',
    }, '2026-08-28T04:00:00.000Z')
    await command('01992d20-3000-7000-8000-000000000503', memberB, {
      kind: 'create-collection', collectionId: collectionB, name: '비공개',
    })
    for (const [index, placeId] of places.slice(0, 3).entries()) {
      await command(`01992d20-3000-7000-8000-${String(510 + index).padStart(12, '0')}`, memberA, {
        kind: 'add-collection-place', collectionId: collectionA, placeId, position: index,
      })
    }
  }

  return {
    database,
    library,
    libraryStore,
    localSearch,
    search,
    queries,
    summaryBatches,
    command,
    seedCollections,
    close: () => database.close(),
  }
}
