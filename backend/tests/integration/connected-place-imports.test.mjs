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
          sourceListId: 'list_fixture',
          sourceListPosition: 0,
          sourcePosition: 0,
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
        (SELECT count(*)::int FROM library.place_preferences WHERE saved) AS saved_places,
        (SELECT count(*)::int FROM library.collections) AS collections,
        (SELECT count(*)::int FROM library.collection_import_provenance) AS import_provenance,
        (SELECT count(*)::int FROM library.collection_places) AS collection_places
    `)
    assert.deepEqual(evidenceCount.rows[0], {
      attempts: 1, captures: 1, items: 1, observations: 1, candidates: 1,
      decisions: 1, canonical_places: 1, provider_links: 1, saved_places: 1,
      collections: 1, import_provenance: 1, collection_places: 1,
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

test('browser connector grants and captures resume safely into one durable import batch', { timeout: 120_000 }, async () => {
  const database = await startPreparedPlaceDatabase('browser-connector-imports')
  const captureRoot = await mkdtemp(join(tmpdir(), 'place-browser-connector-'))
  try {
    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const providers = await import('../../dist/modules/providers/index.js')
    const store = new ingestion.PostgresPlaceImports(database.pool)
    const memberId = '01992d32-0000-7000-8000-000000000001'
    const installationId = '01992d32-0000-7000-8000-000000000002'
    const idempotencyKey = '01992d32-0000-7000-8000-000000000003'
    const operationId = '01992d32-0000-7000-8000-000000000004'
    const connectionId = '01992d32-0000-7000-8000-000000000005'
    const importBatchId = '01992d32-0000-7000-8000-000000000006'
    const generated = [
      operationId, connectionId, importBatchId,
      '01992d32-0000-7000-8000-000000000007',
      '01992d32-0000-7000-8000-000000000008',
      '01992d32-0000-7000-8000-000000000009',
      ...Array.from({ length: 20 }, (_, index) =>
        `01992d32-0000-7000-8001-${String(index + 1).padStart(12, '0')}`),
    ]
    const tokens = [
      'first-connector-token-that-will-be-rotated',
      'second-connector-token-that-remains-active',
    ]
    const at = new Date('2026-08-26T11:00:00.000Z')
    await database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, user_grade, product_tier, created_at, updated_at
       ) VALUES ($1::uuid,'urn:place:test','browser-connector-member','active','member','newcomer','free',$2,$2)`,
      [memberId, at.toISOString()],
    )
    const artifacts = new ingestion.EncryptedFileCaptureArtifactStore({
      root: captureRoot,
      activeKeyId: 'connector-integration',
      keys: { 'connector-integration': new Uint8Array(32).fill(9) },
      maximumBytes: 1_048_576,
      now: () => at,
    })
    const receiver = ingestion.createConnectorImportReceiver({
      store,
      artifacts,
      parsers: [{
        providerKey: 'naver',
        parserVersion: 'naver-saved-place.v1',
        acquisitionKind: 'browser-network',
        parse: (input) => {
          const parsed = providers.parseNaverSavedPlaceCapture(input)
          return parsed.kind === 'page' ? parsed : { kind: 'rejected' }
        },
      }],
      config: {
        publicOrigin: 'https://place.example',
        grantTtlMilliseconds: 600_000,
        captureRetentionMilliseconds: 86_400_000,
        limits: {
          maximumItems: 10_000,
          maximumBytes: 10_485_760,
          maximumBatches: 100,
          maximumBatchBytes: 1_048_576,
        },
      },
      nextId: () => generated.shift(),
      nextToken: () => tokens.shift(),
      now: () => at,
    })
    const request = {
      schemaVersion: 'place-connector-grant-request.v1',
      installationId,
      browserKey: 'whale',
      providerKey: 'naver',
      operation: 'import-saved-library',
      idempotencyKey,
    }
    const firstGrant = await receiver.issueGrant({
      memberId, publicOrigin: 'https://place.example', request,
    })
    assert.equal(firstGrant.status, 'created')
    const resumedGrant = await receiver.issueGrant({
      memberId, publicOrigin: 'https://place.example', request,
    })
    assert.equal(resumedGrant.status, 'replayed')
    assert.equal(resumedGrant.grant.operationId, operationId)
    assert.equal(resumedGrant.grant.token, 'second-connector-token-that-remains-active')

    const payload = JSON.stringify({
      schemaVersion: 'place-naver-saved-capture.v1',
      kind: 'page',
      lists: [{
        listId: 'fukuoka-list', name: '후쿠오카', position: 0,
        bookmarks: [{
          bookmarkId: 'ramen-bookmark', placeId: 'naver-place-1', position: 0,
          name: '라멘 가게', address: '후쿠오카 주소', category: '음식점',
          latitude: 33.59, longitude: 130.4,
        }],
      }],
      nextCursor: null,
    })
    const checksum = createHash('sha256').update(payload).digest('hex')
    const capture = {
      schemaVersion: 'place-connector-capture-batch.v1',
      operationId,
      providerKey: 'naver',
      sequence: 0,
      final: false,
      itemCount: 1,
      contentType: 'application/json',
      payload,
      checksum,
    }
    assert.deepEqual(await receiver.submitCapture({
      token: 'first-connector-token-that-will-be-rotated',
      publicOrigin: 'https://place.example',
      batch: capture,
    }), { status: 'rejected', reason: 'invalid-grant' })
    const accepted = await receiver.submitCapture({
      token: 'second-connector-token-that-remains-active',
      publicOrigin: 'https://place.example',
      batch: capture,
    })
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.receipt.importBatchId, importBatchId)
    assert.equal(accepted.receipt.receivedItems, 1)
    assert.equal(accepted.receipt.receivedBytes, Buffer.byteLength(payload))
    assert.equal((await store.getImport(memberId, importBatchId)).batch.state, 'partial')
    assert.deepEqual(await receiver.submitCapture({
      token: 'second-connector-token-that-remains-active',
      publicOrigin: 'https://place.example',
      batch: { ...capture, sequence: 2, final: true },
    }), { status: 'rejected', reason: 'operation-conflict' })
    const finalPayload = JSON.stringify({
      schemaVersion: 'place-naver-saved-capture.v1',
      kind: 'page', lists: [], nextCursor: null,
    })
    const finalChecksum = createHash('sha256').update(finalPayload).digest('hex')
    const completed = await receiver.submitCapture({
      token: 'second-connector-token-that-remains-active',
      publicOrigin: 'https://place.example',
      batch: {
        ...capture, sequence: 1, final: true, itemCount: 0,
        payload: finalPayload, checksum: finalChecksum,
      },
    })
    assert.equal(completed.status, 'accepted')
    assert.equal(completed.receipt.receivedItems, 1)
    assert.equal(
      completed.receipt.receivedBytes,
      Buffer.byteLength(payload) + Buffer.byteLength(finalPayload),
    )
    assert.equal((await receiver.submitCapture({
      token: 'second-connector-token-that-remains-active',
      publicOrigin: 'https://place.example',
      batch: capture,
    })).status, 'replayed')

    const detail = await store.getImport(memberId, importBatchId)
    assert.equal(detail.batch.state, 'enriching')
    assert.equal(detail.items.length, 1)
    assert.deepEqual(detail.items[0], {
      itemId: detail.items[0].itemId,
      batchId: importBatchId,
      providerKey: 'naver',
      providerPlaceId: 'naver-place-1',
      listName: '후쿠오카',
      name: '라멘 가게',
      address: '후쿠오카 주소',
      categoryLabel: '음식점',
      location: { latitude: 33.59, longitude: 130.4 },
      status: 'enriching',
      reviewReasons: [],
    })
    const persisted = await database.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ingestion.provider_connections) AS connections,
        (SELECT count(*)::int FROM ingestion.import_batches) AS batches,
        (SELECT count(*)::int FROM ingestion.import_jobs) AS acquisition_jobs,
        (SELECT count(*)::int FROM ingestion.connector_import_operations) AS operations,
        (SELECT count(*)::int FROM ingestion.connector_capture_receipts WHERE state = 'committed') AS receipts,
        (SELECT count(*)::int FROM ingestion.import_capture_artifacts) AS artifacts,
        (SELECT count(*)::int FROM ingestion.import_items) AS items,
        (SELECT count(*)::int FROM ingestion.import_place_fulfillment_intents) AS fulfillment_intents,
        (SELECT token_digest FROM ingestion.connector_import_operations LIMIT 1) AS token_digest
    `)
    assert.deepEqual(persisted.rows[0], {
      connections: 1, batches: 1, acquisition_jobs: 0, operations: 1,
      receipts: 2, artifacts: 2, items: 1, fulfillment_intents: 1,
      token_digest: createHash('sha256')
        .update('second-connector-token-that-remains-active').digest('hex'),
    })
    assert.doesNotMatch(JSON.stringify(persisted.rows[0]), /second-connector-token/)
  } finally {
    await database.close()
    await rm(captureRoot, { recursive: true, force: true })
  }
})
