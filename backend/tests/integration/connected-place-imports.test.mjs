import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { startPreparedPlaceDatabase } from './support/prepared-place-database.mjs'

const ids = {
  member: '01992d20-8000-7000-8000-000000000001',
  connection: '01992d20-8000-7000-8000-000000000002',
  batch: '01992d20-8000-7000-8000-000000000003',
  job: '01992d20-8000-7000-8000-000000000004',
  artifact: '01992d20-8000-7000-8000-000000000005',
  item: '01992d20-8000-7000-8000-000000000006',
  observation: '01992d20-8000-7000-8000-000000000007',
  candidate: '01992d20-8000-7000-8000-000000000008',
  decision: '01992d20-8000-7000-8000-000000000009',
  proposedPlace: '01992d20-8000-7000-8000-000000000010',
  idempotency: '01992d20-8000-7000-8000-000000000011',
  reviewCommand: '01992d20-8000-7000-8000-000000000012',
}

test('connected import is durable, replay-safe, fenced, and publicly sanitized', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('connected-place-imports')
  const captureRoot = await mkdtemp(join(tmpdir(), 'place-capture-integration-'))
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const store = new ingestion.PostgresPlaceImports(database.pool)
    const at = '2026-08-26T11:00:00.000Z'
    await database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, user_grade, product_tier, created_at, updated_at
       ) VALUES ($1::uuid,'urn:place:test','connected-import-member','active','member','newcomer','free',$2,$2)`,
      [ids.member, at],
    )
    assert.equal(await store.registerConnection({
      connectionId: ids.connection,
      memberId: ids.member,
      providerKey: 'naver',
      label: '내 NAVER 지도',
      profileReference: 'profile:fixture-member-naver',
      registeredAt: at,
    }), 'registered')
    assert.equal(await store.registerConnection({
      connectionId: ids.connection,
      memberId: ids.member,
      providerKey: 'naver',
      label: '내 NAVER 지도',
      profileReference: 'profile:fixture-member-naver',
      registeredAt: at,
    }), 'replayed')
    const publicConnections = await store.listConnections(ids.member)
    assert.deepEqual(publicConnections, [{
      connectionId: ids.connection,
      providerKey: 'naver',
      label: '내 NAVER 지도',
      status: 'ready',
      lastVerifiedAt: at,
    }])
    assert.doesNotMatch(JSON.stringify(publicConnections), /profile|secret|cookie/i)

    const requested = await ingestion.requestPlaceImport({
      memberId: ids.member,
      connectionId: ids.connection,
      idempotencyKey: ids.idempotency,
      store,
      nextBatchId: () => ids.batch,
      nextJobId: () => ids.job,
      now: () => new Date(at),
    })
    assert.equal(requested.status, 'created')
    const replayed = await ingestion.requestPlaceImport({
      memberId: ids.member,
      connectionId: ids.connection,
      idempotencyKey: ids.idempotency,
      store,
      nextBatchId: () => ids.batch,
      nextJobId: () => ids.job,
      now: () => new Date(at),
    })
    assert.equal(replayed.status, 'replayed')
    assert.equal(replayed.batch.batchId, ids.batch)

    const body = new TextEncoder().encode('{"fixture":true}')
    const checksum = createHash('sha256').update(body).digest('hex')
    let captureClock = new Date(at)
    const captureStore = new ingestion.EncryptedFileCaptureArtifactStore({
      root: captureRoot,
      activeKeyId: 'integration-key',
      keys: { 'integration-key': new Uint8Array(32).fill(7) },
      maximumBytes: 1_048_576,
      now: () => captureClock,
    })
    const source = {
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
          sourceItemKey: 'list_fixture:bookmark_fixture',
          providerPlaceId: 'place_fixture',
          listName: '후쿠오카 여행',
          name: '센카이 라멘',
          address: '일본 후쿠오카현 후쿠오카시',
          categoryLabel: '라멘',
          location: { latitude: 33.5902, longitude: 130.4207 },
          reviewReasons: ['possible-duplicate'],
        }],
        nextCursor: null,
      }),
    }
    const generated = [ids.artifact, ids.item, ids.observation, ids.candidate, ids.decision, ids.proposedPlace]
    const worker = ingestion.createImportWorker({
      workerId: 'integration-worker',
      store,
      captureStore,
      sources: [source],
      nextId: () => generated.shift(),
      now: () => new Date(at),
      leaseMilliseconds: 60_000,
      captureRetentionMilliseconds: 86_400_000,
      maximumAttempts: 5,
      retryDelayMilliseconds: (attempt) => attempt * 1_000,
    })
    assert.deepEqual(await worker.runOne(), {
      status: 'processed', batchId: ids.batch, batchState: 'needs-review', itemCount: 1,
    })
    assert.deepEqual(await worker.runOne(), { status: 'idle' })

    const detail = await store.getImport(ids.member, ids.batch)
    assert.equal(detail.batch.state, 'needs-review')
    assert.equal(detail.batch.progress.discovered, 1)
    assert.equal(detail.items[0].name, '센카이 라멘')
    assert.equal(detail.items[0].status, 'needs-review')
    assert.doesNotMatch(JSON.stringify(detail), /profile:|secret:|cookie/i)

    const places = await import('../../dist/modules/places/index.js')
    const library = await import('../../dist/modules/library/index.js')
    const canonicalStore = new places.PostgresCanonicalResolutionStore(database.pool)
    const libraryStore = new library.PostgresLibraryStore(database.pool)
    const reviewed = await ingestion.reviewImportItem({
      memberId: ids.member,
      commandId: ids.reviewCommand,
      itemId: ids.item,
      action: { kind: 'create-place' },
      occurredAt: '2026-08-26T11:01:00.000Z',
      reviewStore: store,
      ingestionStore: new ingestion.PostgresIngestionStore(database.pool),
      canonical: {
        resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
        apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
      },
      library: {
        saveImportedPlace: (input) => library.saveImportedPlace({ ...input, store: libraryStore }),
      },
    })
    assert.deepEqual(reviewed, {
      status: 'applied', commandId: ids.reviewCommand, itemId: ids.item,
      canonicalPlaceId: ids.proposedPlace,
    })
    const reviewedAgain = await ingestion.reviewImportItem({
      memberId: ids.member,
      commandId: ids.reviewCommand,
      itemId: ids.item,
      action: { kind: 'create-place' },
      occurredAt: '2026-08-26T11:01:00.000Z',
      reviewStore: store,
      ingestionStore: new ingestion.PostgresIngestionStore(database.pool),
      canonical: {
        resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
        apply: (attempt) => places.applyCanonicalResolution({ ...attempt, store: canonicalStore }),
      },
      library: {
        saveImportedPlace: (input) => library.saveImportedPlace({ ...input, store: libraryStore }),
      },
    })
    assert.equal(reviewedAgain.status, 'replayed')
    const completed = await store.getImport(ids.member, ids.batch)
    assert.equal(completed.batch.state, 'completed')
    assert.equal(completed.items[0].status, 'applied')

    const evidenceCount = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ingestion.import_attempts) AS attempts,
        (SELECT count(*)::int FROM ingestion.import_capture_artifacts) AS captures,
        (SELECT count(*)::int FROM ingestion.import_items) AS items,
        (SELECT count(*)::int FROM ingestion.source_observations) AS observations,
        (SELECT count(*)::int FROM ingestion.place_candidates) AS candidates,
        (SELECT count(*)::int FROM ingestion.resolution_decisions) AS decisions,
        (SELECT count(*)::int FROM places.canonical_places) AS canonical_places,
        (SELECT count(*)::int FROM places.provider_place_identities) AS provider_links,
        (SELECT count(*)::int FROM library.place_preferences WHERE saved) AS saved_places
    `)
    assert.deepEqual(evidenceCount.rows[0], {
      attempts: 1, captures: 1, items: 1, observations: 1, candidates: 1,
      decisions: 1, canonical_places: 1, provider_links: 1, saved_places: 1,
    })

    captureClock = new Date('2026-08-28T11:00:00.000Z')
    assert.deepEqual(await ingestion.sweepExpiredImportCaptures({
      expiredAt: captureClock.toISOString(),
      limit: 10,
      retention: store,
      artifacts: captureStore,
    }), { examined: 1, deleted: 1, missing: 0, failed: 0 })
    await assert.rejects(access(join(captureRoot, `${ids.artifact}.capture`)), { code: 'ENOENT' })
    assert.deepEqual(await ingestion.sweepExpiredImportCaptures({
      expiredAt: '2026-08-29T11:00:00.000Z',
      limit: 10,
      retention: store,
      artifacts: captureStore,
    }), { examined: 0, deleted: 0, missing: 0, failed: 0 })
  } finally {
    await database.close()
    await rm(captureRoot, { recursive: true, force: true })
  }
})
