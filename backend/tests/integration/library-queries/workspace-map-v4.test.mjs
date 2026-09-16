import assert from 'node:assert/strict'
import test from 'node:test'

import {
  at,
  collectionA,
  collectionA2,
  collectionB,
  memberA,
  places,
  startLibraryQueriesPostgresFixture,
} from './library-queries-postgres-fixture.mjs'

test('Personal Library map v4 returns one Place with every selected Collection membership', { timeout: 120_000 }, async () => {
  const fixture = await startLibraryQueriesPostgresFixture('place-workspace-map-v4')
  try {
    const { database, library, localSearch, command, seedCollections } = fixture
    await seedCollections()
    await command('01992d20-3000-7000-8000-000000000590', memberA, {
      kind: 'add-collection-place', collectionId: collectionA2, placeId: places[0], position: 0,
    }, at)
    const map = new library.PostgresPersonalLibraryWorkspace(database.pool, async (placeIds) => (
      await localSearch.getPlaceDocuments(placeIds)
    ).map((document) => ({
      placeId: document.placeId,
      name: document.name,
      areaLabel: document.areaLabel,
      location: { latitude: document.latitude, longitude: document.longitude },
      primaryTaxonomy: document.primaryTaxonomy,
      taxonomyKeys: document.taxonomyKeys,
      evidence: { status: document.evidenceStatus, projectedAt: document.projectedAt },
    })))
    const viewport = { bounds: { west: 126, south: 37, east: 128, north: 38 }, zoom: 14 }
    const selected = await map.openMapV4({
      memberId: memberA,
      selection: { kind: 'collections', collectionIds: [collectionA, collectionA2] },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      selectedPlaceId: places[0],
      ...viewport,
    })
    assert.equal(selected.schemaVersion, 'personal-library-map.v4')
    assert.deepEqual(selected.selectedCollections.map((collection) => collection.collectionId), [collectionA, collectionA2])
    assert.ok(selected.selectedCollections.every((collection) => typeof collection.colorToken === 'string'))
    assert.notEqual(selected.selectedCollections[0].colorToken, selected.selectedCollections[1].colorToken)
    const shared = selected.features.find((feature) => feature.kind === 'place' && feature.placeId === places[0])
    assert.deepEqual(shared.memberships.map((membership) => membership.collectionId), [collectionA, collectionA2])
    assert.equal(selected.features.filter((feature) => feature.kind === 'place' && feature.placeId === places[0]).length, 1)
    const workspace = await map.open({
      memberId: memberA,
      favoriteScope: { kind: 'all' },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      limit: 50,
    })
    const revision = workspace.collections.items.find(
      (collection) => collection.collectionId === collectionA,
    ).version
    const lifecycle = new library.PostgresCollectionLifecycle(database.pool)
    const changed = await lifecycle.apply({
      kind: 'update',
      context: { operationId: '01992d20-3000-7000-8000-000000000591', memberId: memberA, occurredAt: at },
      collectionId: collectionA,
      expectedVersion: revision,
      colorToken: 'coral',
    })
    assert.equal(changed.status, 'applied', `color update rejected: ${JSON.stringify(changed)}`)
    const recolored = await map.openMapV4({
      memberId: memberA,
      selection: { kind: 'collections', collectionIds: [collectionA, collectionA2] },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      ...viewport,
    })
    assert.equal(recolored.selectedCollections.find(
      (collection) => collection.collectionId === collectionA,
    ).colorToken, 'coral')
    assert.equal(await map.openMapV4({
      memberId: memberA,
      selection: { kind: 'collections', collectionIds: [collectionA, collectionB] },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      ...viewport,
    }), undefined, 'a foreign Collection must reject the whole selection instead of returning a partial overlay')
  } finally {
    await fixture.close()
  }
})
