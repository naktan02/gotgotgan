import assert from 'node:assert/strict'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const ids = [
  '01992d20-2000-7000-8000-000000000001',
  '01992d20-2000-7000-8000-000000000002',
  '01992d20-2000-7000-8000-000000000003',
  '01992d20-2000-7000-8000-000000000004',
  '01992d20-2000-7000-8000-000000000005',
  '01992d20-2000-7000-8000-000000000006',
  '01992d20-2000-7000-8000-000000000007',
  '01992d20-2000-7000-8000-000000000008',
  '01992d20-2000-7000-8000-000000000009',
  '01992d20-2000-7000-8000-000000000010',
  '01992d20-2000-7000-8000-000000000011',
  '01992d20-2000-7000-8000-000000000012',
  '01992d20-2000-7000-8000-000000000013',
]

test('provider suggestions accumulate as expiring discovery without creating canonical places', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('place-suggestions')
  try {
    const searchModule = await import('../../dist/modules/search/index.js')
    const ingestionModule = await import('../../dist/modules/ingestion/index.js')
    const placesModule = await import('../../dist/modules/places/index.js')
    const store = new searchModule.PostgresPlaceSuggestions(database.pool)
    const provider = {
      sourceKey: 'google',
      suggest: async () => ({
        status: 'complete',
        items: [{
          candidateKey: 'google:google-place-100',
          identity: {
            kind: 'provider', providerKey: 'google', providerPlaceId: 'google-place-100',
          },
          source: {
            key: 'google', label: 'Google Maps', detailsAvailable: true,
            externalUri: 'https://maps.example.invalid/place/100',
            attributions: [{ label: 'Google Maps' }],
          },
          name: '센카이 라멘 후쿠오카 본점',
          areaLabel: '일본 후쿠오카시 하카타구',
          location: { latitude: 33.5902, longitude: 130.4207 },
          categoryLabel: '라멘 전문점',
          observedAt: '2026-08-26T10:00:00.000Z',
        }],
      }),
    }
    const suggest = searchModule.createPlaceSuggestions({
      sources: [store, provider],
      store,
      nextId: () => ids.shift(),
      now: () => new Date('2026-08-26T10:00:00.000Z'),
    })

    const first = await suggest({ query: '센카이', areaText: '후쿠오카', limit: 8 })
    assert.equal(first.items.length, 1)
    assert.equal(first.items[0].identity.kind, 'provider')

    const countsAfterImpression = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM search.discovery_candidates) AS discoveries,
        (SELECT count(*)::int FROM search.suggestion_impressions) AS impressions,
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM ingestion.source_observations) AS observations
    `)
    assert.deepEqual(countsAfterImpression.rows[0], {
      discoveries: 1, impressions: 1, canonical_places: 0, observations: 0,
    })

    const repeated = await searchModule.createPlaceSuggestions({
      sources: [store],
      store,
      nextId: () => ids.shift(),
      now: () => new Date('2026-08-26T10:01:00.000Z'),
    })({ query: '센카이 후쿠오카', limit: 8, sessionId: first.sessionId })
    assert.equal(repeated.items.length, 1)
    assert.equal(repeated.items[0].name, '센카이 라멘 후쿠오카 본점')
    assert.equal(repeated.items[0].suggestionId, first.items[0].suggestionId)

    const ingestionStore = new ingestionModule.PostgresIngestionStore(database.pool)
    const canonicalStore = new placesModule.PostgresCanonicalResolutionStore(database.pool)
    let currentTime = '2026-08-26T10:02:00.000Z'
    const select = searchModule.createPlaceSuggestionSelection({
      store,
      now: () => new Date(currentTime),
      recordObservation: async (input) => (
        await ingestionModule.recordSuggestionObservation(input, ingestionStore)
      ).status,
    })
    assert.equal((await select(first.items[0].suggestionId)).status, 'recorded')
    currentTime = '2026-08-26T10:03:00.000Z'
    assert.equal((await select(first.items[0].suggestionId)).status, 'replayed')
    const discovery = await database.pool.query(
      'SELECT impression_count, selection_count FROM search.discovery_candidates',
    )
    assert.deepEqual(discovery.rows[0], { impression_count: '1', selection_count: '1' })

    const materialize = searchModule.createPlaceSuggestionMaterialization({
      store,
      now: () => new Date(currentTime),
      materialize: (input) => ingestionModule.materializeSuggestedPlace({
        input,
        ingestionStore,
        canonical: {
          resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
          apply: (attempt) => placesModule.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
        },
      }),
    })
    const created = await materialize(first.items[0].suggestionId, 'save')
    assert.equal(created.status, 'created')
    const replay = await materialize(first.items[0].suggestionId, 'save')
    assert.equal(replay.status, 'replayed')
    const durable = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ingestion.source_observations) AS observations,
        (SELECT count(*)::int FROM ingestion.place_candidates) AS candidates,
        (SELECT count(*)::int FROM ingestion.resolution_decisions) AS decisions,
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM places.provider_place_identities) AS provider_links
    `)
    assert.deepEqual(durable.rows[0], {
      observations: 1, candidates: 1, decisions: 1, canonical_places: 1, provider_links: 1,
    })

    const cleaned = await store.cleanupExpired('2026-08-26T11:00:00.000Z', 100)
    assert.ok(cleaned.sessions >= 1)
    assert.ok(cleaned.discoveries >= 1)
  } finally {
    await database.close()
  }
})
