import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const id = (suffix) => `01992d21-1000-7000-8000-${String(suffix).padStart(12, '0')}`
const at = '2026-08-26T14:00:00.000Z'

test('missing imported places coalesce for enrichment and later imports use the canonical cache', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('imported-place-fulfillment')
  const captureRoot = await mkdtemp(join(tmpdir(), 'place-fulfillment-capture-'))
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const places = await import('../../dist/modules/places/index.js')
    const library = await import('../../dist/modules/library/index.js')
    const store = new ingestion.PostgresPlaceImports(database.pool)
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
          sourceListPosition: 0,
          sourcePosition: 0,
          providerPlaceId: 'naver-shared-place',
          listName: '가보고 싶은 곳',
          name: '센카이 라멘',
          address: null,
          categoryLabel: '라멘',
          location: null,
          reviewReasons: [],
        }, {
          sourceItemKey: 'list_fixture_secondary:shared_place',
          sourceListId: 'list_fixture_secondary',
          sourceListPosition: 1,
          sourcePosition: 0,
          providerPlaceId: 'naver-shared-place',
          listName: '라멘 모음',
          name: '신카이 라멘',
          address: null,
          categoryLabel: '라멘',
          location: null,
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
      assert.equal(await store.registerConnection({
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
        store,
        nextBatchId: () => batchId,
        nextJobId: () => jobId,
        now: () => new Date(at),
      })
      const generated = Array.from({ length: 21 }, (_, index) => id(sequence + 10 + index))
      const acquisition = ingestion.createImportWorker({
        workerId: `acquisition-${sequence}`,
        store,
        captureStore,
        sources: [listSource],
        nextId: () => generated.shift(),
        now: () => new Date(at),
        leaseMilliseconds: 60_000,
        captureRetentionMilliseconds: 86_400_000,
        maximumAttempts: 5,
        retryDelayMilliseconds: (attempt) => attempt * 1_000,
      })
      assert.deepEqual(await acquisition.runOne(), {
        status: 'processed', batchId, batchState: 'enriching', itemCount: 2,
      })
      const detail = await store.getImport(memberId, batchId)
      assert.equal(detail.batch.state, 'enriching')
      assert.equal(detail.batch.progress.enriching, 2)
      assert.equal(detail.items[0].status, 'enriching')
      return { memberId, batchId }
    }

    const first = await registerMemberAndImport(100)
    const second = await registerMemberAndImport(200)
    const queued = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_jobs) AS jobs,
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_intents) AS intents
    `)
    assert.deepEqual(queued.rows[0], { jobs: 1, intents: 4 })

    let detailReads = 0
    const detailSource = {
      providerKey: 'naver',
      readDetail: async () => {
        detailReads += 1
        return {
          kind: 'detail',
          evidence: {
            checksum: 'c'.repeat(64),
            parserVersion: 'naver-place-detail.v1',
            acquisitionKind: 'structured-web',
            observedAt: at,
          },
          place: {
            name: '센카이 라멘 본점',
            address: '일본 후쿠오카현 후쿠오카시 하카타구',
            categoryLabel: '라멘',
            location: { latitude: 33.5902, longitude: 130.4207 },
            reviewReasons: [],
          },
        }
      },
    }
    const fulfillment = ingestion.createImportedPlaceFulfillmentWorker({
      workerId: 'fulfillment-worker',
      store,
      ingestionStore,
      canonical,
      library: importedLibrary,
      sources: [detailSource],
      now: () => new Date(at),
      leaseMilliseconds: 60_000,
      maximumAttempts: 5,
      retryDelayMilliseconds: (attempt) => attempt * 1_000,
    })
    const fulfilled = await fulfillment.runOne()
    assert.equal(fulfilled.status, 'completed')
    assert.equal(fulfilled.fulfilled, 4)
    assert.equal(detailReads, 1)
    assert.equal((await store.getImport(first.memberId, first.batchId)).batch.state, 'completed')
    assert.equal((await store.getImport(second.memberId, second.batchId)).batch.state, 'completed')

    const third = await registerMemberAndImport(300)
    const cached = await fulfillment.runOne()
    assert.equal(cached.status, 'completed')
    assert.equal(cached.fulfilled, 2)
    assert.equal(detailReads, 1)
    assert.equal((await store.getImport(third.memberId, third.batchId)).batch.state, 'completed')

    const results = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM places.provider_place_identities) AS provider_links,
        (SELECT count(*)::int FROM library.place_preferences WHERE saved) AS saved_places,
        (SELECT count(*)::int FROM library.collections) AS collections,
        (SELECT count(*)::int FROM library.collection_import_provenance) AS import_provenance,
        (SELECT count(*)::int FROM library.collection_places) AS collection_places,
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
      collection_places: 6,
      jobs: 1,
      demand_attempts: 1,
      applied_intents: 6,
    })
  } finally {
    await database.close()
    await rm(captureRoot, { recursive: true, force: true })
  }
})
