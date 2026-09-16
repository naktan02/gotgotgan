import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const id = (suffix) => `01992d21-1000-7000-8000-${String(suffix).padStart(12, '0')}`
const at = '2026-08-26T14:00:00.000Z'

test('imported snapshots coalesce for immediate save while details remain pending', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('imported-place-fulfillment')
  const captureRoot = await mkdtemp(join(tmpdir(), 'place-fulfillment-capture-'))
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const places = await import('../../dist/modules/places/index.js')
    const library = await import('../../dist/modules/library/index.js')
    const connectorImports = new ingestion.PostgresConnectorImports(database.pool)
    const importQueue = new ingestion.PostgresImportQueue(database.pool)
    const importReview = new ingestion.PostgresImportReview(database.pool)
    const importQueries = new ingestion.PostgresImportQueries(database.pool)
    const fulfillmentStore = new ingestion.PostgresImportedPlaceFulfillment(database.pool)
    const ingestionStore = new ingestion.PostgresIngestionStore(database.pool)
    const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
    const libraryStore = new library.PostgresLibraryStore(database.pool)
    const canonical = {
      resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
      apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
    }
    const importedLibrary = {
      saveImportedPlace: (input) => library.saveImportedPlace({ ...input, store: libraryStore }),
    }
    const captureStore = new ingestion.EncryptedFileCaptureArtifactStore({
      root: captureRoot,
      activeKeyId: 'fulfillment-key',
      keys: { 'fulfillment-key': new Uint8Array(32).fill(8) },
      maximumBytes: 1_048_576,
      now: () => new Date(at),
    })
    const body = new TextEncoder().encode('{"fixture":"same-provider-place"}')
    const checksum = createHash('sha256').update(body).digest('hex')
    const listSource = {
      providerKey: 'naver',
      readPage: async () => ({
        kind: 'page',
        capture: {
          body,
          checksum,
          contentType: 'application/json',
          acquisitionKind: 'browser-network',
          parserVersion: 'naver-saved-place.v1',
          observedAt: at,
        },
        items: [{
          sourceItemKey: 'list_fixture:shared_place',
          sourceListId: 'list_fixture',
          sourceItemId: 'shared_place',
          sourceListPosition: 0,
          sourcePosition: 0,
          providerPlaceId: 'naver-shared-place',
          listName: '가보고 싶은 곳',
          name: '센카이 라멘',
          address: '서울 성동구 성수동',
          categoryLabel: '라멘',
          location: { latitude: 37.5445, longitude: 127.056 },
          reviewReasons: [],
        }, {
          sourceItemKey: 'list_fixture:shared_place_duplicate',
          sourceListId: 'list_fixture',
          sourceItemId: 'shared_place_duplicate',
          sourceListPosition: 0,
          sourcePosition: 1,
          providerPlaceId: 'naver-shared-place',
          listName: '가보고 싶은 곳',
          name: '센카이 라멘',
          address: '서울 성동구 성수동',
          categoryLabel: '라멘',
          location: { latitude: 37.5445, longitude: 127.056 },
          reviewReasons: [],
        }, {
          sourceItemKey: 'list_fixture_secondary:shared_place',
          sourceListId: 'list_fixture_secondary',
          sourceItemId: 'shared_place',
          sourceListPosition: 1,
          sourcePosition: 0,
          providerPlaceId: 'naver-shared-place',
          listName: '라멘 모음',
          name: '신카이 라멘',
          address: '서울 성동구 성수동',
          categoryLabel: '라멘',
          location: { latitude: 37.5445, longitude: 127.056 },
          reviewReasons: [],
        }],
        nextCursor: null,
      }),
    }

    async function registerMemberAndImport(sequence) {
      const memberId = id(sequence)
      const connectionId = id(sequence + 1)
      const batchId = id(sequence + 2)
      const jobId = id(sequence + 3)
      await database.pool.query(
        `INSERT INTO access.memberships (
           id, issuer, subject, status, authority_role, user_grade, product_tier, created_at, updated_at
         ) VALUES ($1::uuid,'urn:place:test',$2,'active','member','newcomer','free',$3,$3)`,
        [memberId, `fulfillment-member-${sequence}`, at],
      )
      assert.equal(await connectorImports.registerConnection({
        connectionId,
        memberId,
        providerKey: 'naver',
        label: '내 NAVER 지도',
        profileReference: `client-profile:member-${sequence}`,
        registeredAt: at,
      }), 'registered')
      await ingestion.requestPlaceImport({
        memberId,
        connectionId,
        idempotencyKey: id(sequence + 4),
        store: importQueue,
        nextBatchId: () => batchId,
        nextJobId: () => jobId,
        now: () => new Date(at),
      })
      const generated = Array.from({ length: 40 }, (_, index) => id(sequence + 10 + index))
      const acquisition = ingestion.createImportWorker({
        workerId: `acquisition-${sequence}`,
        store: importQueue,
        captureStore,
        sources: [{ ...listSource, async readPage() {
          const page = await listSource.readPage()
          return { ...page, items: page.items.map((item) => ({
            ...item, name: sequence === 200 ? '다른 회원의 장소 별명' : item.name,
            address: sequence === 200 ? '부산 해운대' : item.address,
            categoryLabel: sequence === 200 ? '원문분류>티룸' : '원문분류>쇼유라멘',
          })) }
        } }],
        nextId: () => generated.shift(),
        now: () => new Date(at),
        leaseMilliseconds: 60_000,
        captureRetentionMilliseconds: 86_400_000,
        maximumAttempts: 5,
        retryDelayMilliseconds: (attempt) => attempt * 1_000,
      })
      assert.deepEqual(await acquisition.runOne(), {
        status: 'processed', batchId, batchState: 'enriching', itemCount: 3,
      })
      const detail = await importQueries.getBatch({ memberId, batchId, limit: 200 })
      assert.equal(detail.batch.state, 'enriching')
      assert.equal(detail.batch.progress.enriching, 3)
      assert.equal(detail.items[0].status, 'enriching')
      return { memberId, batchId }
    }

    const first = await registerMemberAndImport(100)
    const second = await registerMemberAndImport(200)
    const queued = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_jobs) AS jobs,
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_intents) AS intents,
        (SELECT count(*)::int FROM ingestion.provider_place_detail_jobs) AS detail_jobs
    `)
    assert.deepEqual(queued.rows[0], { jobs: 1, intents: 6, detail_jobs: 1 })

    const fulfillment = ingestion.createImportedPlaceFulfillmentWorker({
      workerId: 'materialization-worker',
      store: fulfillmentStore,
      ingestionStore,
      canonical,
      library: importedLibrary,
      now: () => new Date(at),
      leaseMilliseconds: 60_000,
    })
    const fulfilled = await fulfillment.runOne()
    assert.equal(fulfilled.status, 'completed')
    assert.equal(fulfilled.fulfilled, 6)
    assert.equal((await importQueries.getBatch({ memberId: first.memberId, batchId: first.batchId, limit: 200 })).batch.state, 'completed')
    assert.equal((await importQueries.getBatch({ memberId: second.memberId, batchId: second.batchId, limit: 200 })).batch.state, 'completed')

    const third = await registerMemberAndImport(300)
    const cached = await fulfillment.runOne()
    assert.equal(cached.status, 'completed')
    assert.equal(cached.fulfilled, 3)
    assert.equal((await importQueries.getBatch({ memberId: third.memberId, batchId: third.batchId, limit: 200 })).batch.state, 'completed')

    const results = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM places.provider_place_identities) AS provider_links,
        (SELECT count(*)::int FROM library.place_preferences WHERE saved) AS saved_places,
        (SELECT count(*)::int FROM library.collections) AS collections,
        (SELECT count(*)::int FROM library.collection_import_provenance) AS import_provenance,
        (SELECT count(*)::int FROM library.collection_place_import_provenance) AS item_provenance,
        (SELECT count(*)::int FROM library.collection_places) AS collection_places,
        (SELECT count(*)::int FROM ingestion.provider_place_detail_statuses WHERE status = 'pending') AS pending_details,
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_jobs) AS jobs,
        (SELECT attempt_count FROM ingestion.import_place_fulfillment_jobs) AS demand_attempts,
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_intents WHERE state = 'applied') AS applied_intents
    `)
    assert.deepEqual(results.rows[0], {
      canonical_places: 1,
      provider_links: 1,
      saved_places: 3,
      collections: 6,
      import_provenance: 6,
      item_provenance: 9,
      collection_places: 6,
      pending_details: 1,
      jobs: 1,
      demand_attempts: 1,
      applied_intents: 9,
    })

    const ownMinimum = await importQueries.readAppliedPlaces(first.memberId, [fulfilled.canonicalPlaceId])
    assert.equal(ownMinimum.length, 1)
    assert.deepEqual(ownMinimum[0], {
      placeId: fulfilled.canonicalPlaceId,
      observedName: '센카이 라멘', observedAddress: '서울 성동구 성수동', observedCategory: '원문분류>쇼유라멘',
      observedLocation: { latitude: 37.5445, longitude: 127.056 }, capturedAt: at,
    })
    assert.deepEqual(await importQueries.readAppliedPlaces(id(999), [fulfilled.canonicalPlaceId]), [])
    assert.equal((await importQueries.readAppliedPlaces(second.memberId, [fulfilled.canonicalPlaceId]))[0].observedName,
      '다른 회원의 장소 별명')
    assert.deepEqual(await importQueries.readAppliedPlaces(first.memberId, []), [])
    await assert.rejects(importQueries.readAppliedPlaces(first.memberId,
      Array(2_001).fill(fulfilled.canonicalPlaceId)), ingestion.InvalidImportQueryError)

    const search = await import('../../dist/modules/search/index.js')
    const localSearch = new search.PostgresLocalSearch(database.pool)
    const readPrivate = async (memberId, placeIds) => (await importQueries.readAppliedPlaces(memberId, placeIds))
      .map((value) => ({ summary: { placeId: value.placeId, name: value.observedName, areaLabel: null,
        location: value.observedLocation, primaryTaxonomy: null, taxonomyKeys: [],
        evidence: { status: 'unverified', projectedAt: value.capturedAt } },
      sourceObservedSearchText: [value.observedAddress, value.observedCategory].filter(Boolean).join(' ') }))
    const workspace = new library.PostgresPersonalLibraryWorkspace(database.pool,
      (placeIds) => localSearch.getCatalogPlaceDocuments(placeIds), readPrivate)
    const query = { memberId: first.memberId, favoriteScope: { kind: 'all' },
      ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 50 }
    const visible = await workspace.open(query)
    assert.equal(visible.favoritePlaces.items[0].place.name, '센카이 라멘')
    assert.equal(visible.favoritePlaces.items[0].place.primaryTaxonomy, null)
    const map = await workspace.openMap({ ...query,
      bounds: { west: 126, south: 37, east: 128, north: 38 }, zoom: 12 })
    assert.deepEqual(map.coverage, { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true })
    assert.equal(map.features[0].placeId, fulfilled.canonicalPlaceId)

    const publicSummary = { ...visible.favoritePlaces.items[0].place, name: '공개 카탈로그 이름',
      primaryTaxonomy: { key: 'food', label: '음식점' }, taxonomyKeys: ['food'],
      evidence: { status: 'verified', projectedAt: at } }
    const publicPreferred = new library.PostgresPersonalLibraryWorkspace(database.pool,
      async () => [publicSummary], readPrivate)
    for (const [reader, expectedName, expectedTaxonomies] of [
      [workspace, '센카이 라멘', []], [publicPreferred, '공개 카탈로그 이름', ['food']],
    ]) {
      const scoped = { ...query, placeQuery: '성수동 쇼유라멘',
        bounds: { west: 126, south: 37, east: 130, north: 39 }, zoom: 12 }
      const ownSearch = await reader.open(scoped)
      assert.equal(ownSearch.favoritePlaces.items.length, 1, 'owner original address/category supplement both public and fallback names')
      assert.equal(ownSearch.favoritePlaces.items[0].place.name, expectedName)
      assert.equal((await reader.openMap(scoped)).coverage.representedPlaceCount, 1)
      assert.deepEqual(ownSearch.availableFilters.areas, [], 'source address is not promoted into a region facet')
      assert.deepEqual(ownSearch.availableFilters.taxonomies.map((facet) => facet.key), expectedTaxonomies)
      assert.ok(!JSON.stringify(ownSearch).includes('원문분류>'), 'raw source category remains off the wire')
      assert.ok(!JSON.stringify(ownSearch).includes('sourceObservedSearchText'))
      const otherScope = { ...scoped, memberId: second.memberId }
      assert.equal((await reader.open(otherScope)).favoritePlaces.items.length, 0, 'same canonical identity does not grant another owner source text')
      assert.equal((await reader.openMap(otherScope)).coverage.representedPlaceCount, 0)
      const otherOwn = { ...otherScope, placeQuery: '해운대 티룸' }
      assert.equal((await reader.open(otherOwn)).favoritePlaces.items.length, 1)
      assert.equal((await reader.openMap(otherOwn)).coverage.representedPlaceCount, 1)
      assert.equal((await reader.open({ ...scoped, placeQuery: '해운대 티룸' })).favoritePlaces.items.length, 0)
      assert.equal((await reader.open({ ...scoped, taxonomyKeys: ['raw.shoyu'] })).favoritePlaces.items.length, 0)
      assert.equal((await reader.openMap({ ...scoped, taxonomyKeys: ['raw.shoyu'] })).coverage.representedPlaceCount, 0)
    }

    const read = places.createPlaceDetailReader({ canonical: canonicalStore,
      readDocument: (placeId) => localSearch.getPlaceDocument(placeId),
      readPersonal: async () => ({ visits: { visited: false, count: 0 } }),
    })
    const readMember = places.createMemberPlaceDetailReader({ read,
      readSourceObservedPlace: async (memberId, placeId) => {
        const value = (await importQueries.readAppliedPlaces(memberId, [placeId]))[0]
        return value === undefined ? undefined : { name: value.observedName, address: value.observedAddress,
          categoryLabel: value.observedCategory, location: value.observedLocation, capturedAt: value.capturedAt }
      },
    })
    const direct = await readMember({ requestedPlaceId: fulfilled.canonicalPlaceId, memberId: first.memberId })
    assert.equal(direct.detail.schemaVersion, 'place-detail.v2')
    assert.equal(direct.detail.status, 'pending')
    assert.equal(direct.detail.personalState.sourceObservedPlace.name, '센카이 라멘')
    assert.deepEqual(direct.detail.personalState.sourceObservedPlace.location, { latitude: 37.5445, longitude: 127.056 })
    assert.equal((await readMember({ requestedPlaceId: fulfilled.canonicalPlaceId,
      memberId: id(999) })).detail.personalState.sourceObservedPlace, undefined)
    assert.equal((await read({ requestedPlaceId: fulfilled.canonicalPlaceId })).status, 'unavailable')
    assert.deepEqual(await localSearch.getCatalogPlaceDocuments([fulfilled.canonicalPlaceId]), [],
      'private imported labels and coordinates are not published as catalog facts')

    const snapshot = await database.pool.query(`
      SELECT observation.id AS observation_id, candidate.id AS candidate_id
      FROM ingestion.source_observations AS observation
      JOIN ingestion.place_candidates AS candidate
        ON candidate.source_observation_id = observation.id
      WHERE observation.provider_key = 'naver'
        AND observation.external_place_id = 'naver-shared-place'
        AND observation.observation_kind = 'general'
      LIMIT 1
    `)
    assert.equal(snapshot.rowCount, 1)
    await assert.rejects(
      database.pool.query(
        `INSERT INTO ingestion.provider_place_detail_observations (
           provider_key, provider_place_id, source_observation_id,
           place_candidate_id, normalized_at
         ) VALUES ('naver','naver-shared-place',$1::uuid,$2::uuid,$3::timestamptz)`,
        [snapshot.rows[0].observation_id, snapshot.rows[0].candidate_id, at],
      ),
      (error) => error.code === '23503',
    )

    const detailObservationId = id(900)
    const detailCandidateId = id(901)
    await ingestion.recordSourceObservation({
      id: detailObservationId,
      providerKey: 'naver',
      externalPlaceId: 'naver-shared-place',
      observationKind: 'provider-detail',
      acquisitionKind: 'browser-network',
      payloadChecksum: 'b'.repeat(64),
      parserVersion: 'naver-place-detail.v1',
      observedAt: at,
      acquiredAt: at,
      facts: { name: '센카이 라멘', detail: true },
      confidence: 0.9,
      store: ingestionStore,
    })
    await ingestion.recordPlaceCandidate({
      id: detailCandidateId,
      sourceObservationId: detailObservationId,
      parserVersion: 'provider-detail-normalizer.v1',
      name: '센카이 라멘',
      attributes: { providerKey: 'naver', externalPlaceId: 'naver-shared-place' },
      createdAt: at,
      store: ingestionStore,
    })
    await database.pool.query(
      `INSERT INTO ingestion.provider_place_detail_observations (
         provider_key, provider_place_id, source_observation_id,
         place_candidate_id, normalized_at
       ) VALUES ('naver','naver-shared-place',$1::uuid,$2::uuid,$3::timestamptz)`,
      [detailObservationId, detailCandidateId, at],
    )
    await database.pool.query(
      `UPDATE ingestion.provider_place_detail_statuses
       SET status = 'available', last_detail_observation_id = $1::uuid,
           updated_at = $2::timestamptz
       WHERE provider_key = 'naver' AND provider_place_id = 'naver-shared-place'`,
      [detailObservationId, at],
    )
    const available = await database.pool.query(`
      SELECT status, last_detail_observation_id
      FROM ingestion.provider_place_detail_statuses
      WHERE provider_key = 'naver' AND provider_place_id = 'naver-shared-place'
    `)
    assert.deepEqual(available.rows[0], {
      status: 'available',
      last_detail_observation_id: detailObservationId,
    })
  } finally {
    await database.close()
    await rm(captureRoot, { recursive: true, force: true })
  }
})
