import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { startPreparedPlaceDatabase } from '../support/prepared-place-database.mjs'

const ids = Array.from({ length: 120 }, (_, index) => (
  `01995000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
))
const memberId = ids[0]
const otherMemberId = ids[1]
const at = '2026-09-05T03:00:00.000Z'

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function delegate(store, overrides = {}) {
  return {
    reserve: (input) => store.reserve(input),
    activate: (input) => store.activate(input),
    get: (member, acquisition) => store.get(member, acquisition),
    cancel: (input) => store.cancel(input),
    claim: (input) => store.claim(input),
    recordInspectionSnapshot: (input) => store.recordInspectionSnapshot(input),
    complete: (input) => store.complete(input),
    expire: (input) => store.expire(input),
    pendingArtifactCleanup: (limit) => store.pendingArtifactCleanup(limit),
    markArtifactDeleted: (acquisition, deletedAt) =>
      store.markArtifactDeleted(acquisition, deletedAt),
    ...overrides,
  }
}

async function capturePath(root, artifactId) {
  const name = (await readdir(root)).find((candidate) =>
    candidate.startsWith(`${artifactId}.`) && candidate.endsWith('.capture'))
  assert.notEqual(name, undefined)
  return join(root, name)
}

test('durable web imports preserve replay, owner, lease, artifact, and source boundaries', {
  timeout: 120_000,
}, async () => {
  const database = await startPreparedPlaceDatabase('gotgotgan-web-import-acquisitions')
  const artifactRoot = await mkdtemp(join(tmpdir(), 'gotgotgan-web-import-'))
  let now = new Date(at)
  try {
    const { EncryptedFileCaptureArtifactStore } =
      await import('../../../dist/modules/ingestion/index.js')
    const { WebImportAcquisitions } =
      await import('../../../dist/modules/transfers/index.js')
    const { PostgresWebImportAcquisitions } =
      await import('../../../dist/modules/transfers/adapters/persistence/postgres-web-import-acquisitions.js')
    const { createWebImportAcquisitionWorker } =
      await import('../../../dist/modules/transfers/application/web-import-acquisition-worker.js')

    await database.pool.query(
      `INSERT INTO access.memberships (
         id, issuer, subject, status, authority_role, product_tier, user_grade,
         created_at, updated_at
       ) VALUES
         ($1::uuid,'https://identity.example.test','web-import-owner','active','member',
          'standard','unclassified',$3::timestamptz,$3::timestamptz),
         ($2::uuid,'https://identity.example.test','web-import-other','active','member',
          'standard','unclassified',$3::timestamptz,$3::timestamptz)`,
      [memberId, otherMemberId, at],
    )

    const durableStore = new PostgresWebImportAcquisitions(database.pool, () => now)
    const artifacts = new EncryptedFileCaptureArtifactStore({
      root: artifactRoot,
      activeKeyId: 'web-import-test',
      keys: { 'web-import-test': new Uint8Array(32).fill(7) },
      maximumBytes: 1_000_000,
      now: () => now,
    })
    let inspectionCount = 0
    const sharedLinks = {
      providerKey: 'naver',
      async inspect({ entries }) {
        inspectionCount += 1
        return [{
          entryId: entries[0].entryId,
          position: entries[0].position,
          status: 'succeeded',
          inputUrlDigest: digest(entries[0].url.trim()),
          shareId: 'shared-list-1',
          list: {
            sourceListId: 'shared-list-1',
            observedName: inspectionCount === 1 ? '서울 카페' : '변경된 서울 카페',
            sourcePosition: 0,
            items: [{
              sourceItemId: 'bookmark-1',
              providerPlaceId: 'naver-place-1',
              observedName: '곳곳카페',
              observedAddress: '서울 종로구',
              observedCategory: '카페',
              observedLocation: { latitude: 37.57, longitude: 126.98 },
              sourcePosition: 0,
            }],
          },
        }, {
          entryId: entries[1].entryId,
          position: entries[1].position,
          status: 'failed',
          inputUrlDigest: digest(entries[1].url.trim()),
          code: 'share-not-readable',
          retryable: false,
        }, {
          entryId: entries[2].entryId,
          position: entries[2].position,
          status: 'duplicate',
          inputUrlDigest: digest(entries[2].url.trim()),
          duplicateOfEntryId: entries[0].entryId,
        }]
      },
    }
    const acquisitions = new WebImportAcquisitions({
      store: durableStore,
      artifacts,
      artifactRetentionMilliseconds: 900_000,
      remoteBrowserEnabled: true,
      nextArtifactId: () => ids[21],
      now: () => now,
    })
    const rawLinks = [
      'https://naver.me/TestLink1',
      'https://naver.me/TestLink2',
      'https://naver.me/TestLink1',
    ]
    const sharedCommand = {
      schemaVersion: 'start-import-acquisition.v1',
      kind: 'shared-links',
      commandId: ids[2],
      acquisitionId: ids[3],
      importSourceId: ids[4],
      snapshotId: ids[5],
      providerKey: 'naver',
      links: rawLinks.map((url, position) => ({
        entryId: ids[6 + position], position, url,
      })),
    }

    const started = await acquisitions.start(memberId, sharedCommand)
    assert.equal(started.outcome, 'accepted')
    assert.equal(started.status, 'applied')
    assert.equal(started.acquisition.state, 'processing')
    assert.deepEqual(started.acquisition.items.map((item) => item.state), [
      'pending', 'pending', 'pending',
    ])
    assert.equal(inspectionCount, 0)

    const sharedArtifact = await capturePath(artifactRoot, ids[21])
    const rawArtifact = await readFile(sharedArtifact, 'utf8')
    assert.equal(rawLinks.some((link) => rawArtifact.includes(link)), false)
    assert.deepEqual((await database.pool.query(
      `SELECT state, artifact_reference, artifact_checksum,
              artifact_retained_until, artifact_deleted_at
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [sharedCommand.acquisitionId],
    )).rows.map((row) => ({
      state: row.state,
      reference: row.artifact_reference,
      checksum: row.artifact_checksum,
      retainedUntil: row.artifact_retained_until.toISOString(),
      deletedAt: row.artifact_deleted_at,
    })), [{
      state: 'queued',
      reference: `capture:${ids[21]}`,
      checksum: digest(JSON.stringify(sharedCommand)),
      retainedUntil: '2026-09-05T03:15:00.000Z',
      deletedAt: null,
    }])

    let failCompletion = true
    const firstWorkerStore = delegate(durableStore, {
      async complete(input) {
        if (failCompletion) {
          failCompletion = false
          throw new Error('simulated crash after snapshot')
        }
        return durableStore.complete(input)
      },
    })
    const firstWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-a',
      leaseMilliseconds: 600_000,
      store: firstWorkerStore,
      artifacts,
      source: sharedLinks,
      now: () => now,
    })
    assert.equal((await firstWorker.runOne()).status, 'deferred')
    assert.equal((await database.pool.query(
      'SELECT count(*)::int AS count FROM transfers.source_snapshots WHERE id = $1::uuid',
      [sharedCommand.snapshotId],
    )).rows[0].count, 1)
    assert.equal((await database.pool.query(
      `SELECT inspection_results #>> '{0,list,observedName}' AS observed_name
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [sharedCommand.acquisitionId],
    )).rows[0].observed_name, '서울 카페')

    now = new Date('2026-09-05T03:16:00.000Z')
    const reclaimingWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-b',
      leaseMilliseconds: 180_000,
      store: durableStore,
      artifacts,
      source: sharedLinks,
      now: () => now,
    })
    assert.equal((await reclaimingWorker.runOne()).status, 'processed')
    assert.equal(inspectionCount, 1)
    assert.deepEqual((await database.pool.query(
      `SELECT state, attempt_count, lease_generation, artifact_deleted_at IS NOT NULL AS deleted,
              inspection_results IS NULL AS inspection_cleared
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [sharedCommand.acquisitionId],
    )).rows, [{
      state: 'completed', attempt_count: 2, lease_generation: '2', deleted: true,
      inspection_cleared: true,
    }])
    await assert.rejects(access(sharedArtifact))

    const completed = await acquisitions.get(memberId, sharedCommand.acquisitionId)
    assert.equal(completed.state, 'partial')
    assert.deepEqual(completed.progress, { total: 3, processed: 3, ready: 1, failed: 1 })
    assert.deepEqual(completed.items.map((item) => item.state), [
      'ready', 'unavailable', 'duplicate',
    ])
    assert.equal(completed.snapshot.snapshotId, sharedCommand.snapshotId)
    assert.equal(await acquisitions.get(otherMemberId, sharedCommand.acquisitionId), undefined)

    const replayed = await acquisitions.start(memberId, sharedCommand)
    assert.equal(replayed.outcome, 'accepted')
    assert.equal(replayed.status, 'replayed')
    assert.equal(inspectionCount, 1)

    const conflictingReplay = await acquisitions.start(memberId, {
      ...sharedCommand,
      links: sharedCommand.links.map((link, index) => index === 1
        ? { ...link, url: 'https://naver.me/TestLink3' }
        : link),
    })
    assert.deepEqual(conflictingReplay, {
      schemaVersion: 'import-acquisition-command-result.v1',
      outcome: 'rejected',
      commandId: sharedCommand.commandId,
      rejection: { code: 'command-id-reused' },
    })

    const exponentCommand = {
      ...sharedCommand,
      commandId: ids[67], acquisitionId: ids[68], importSourceId: ids[69],
      snapshotId: ids[70],
      links: Array.from({ length: 20 }, (_, position) => ({
        entryId: ids[71 + position], position,
        url: `https://naver.me/Exponent${position}`,
      })),
    }
    const exponentAcquisition = new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[91], now: () => now,
    })
    assert.equal((await exponentAcquisition.start(otherMemberId, exponentCommand)).outcome, 'accepted')
    const exponentResults = exponentCommand.links.map((entry) => ({
      entryId: entry.entryId, position: entry.position, status: 'succeeded',
      inputUrlDigest: digest(entry.url), shareId: `exponent-share-${entry.position}`,
      list: {
        sourceListId: `exponent-share-${entry.position}`,
        observedName: `exponent-list-${entry.position}`,
        sourcePosition: entry.position,
        items: Array.from({ length: 500 }, (_, sourcePosition) => ({
          sourceItemId: `item-${entry.position}-${sourcePosition}`,
          providerPlaceId: null,
          observedName: `place-${entry.position}-${sourcePosition}`,
          observedAddress: null,
          observedCategory: null,
          observedLocation: { latitude: 5e-324, longitude: 5e-324 },
          sourcePosition,
        })),
      },
    }))
    assert.ok(Buffer.byteLength(JSON.stringify(exponentResults), 'utf8') <= 7.5 * 1024 * 1024)
    let exponentInspectionCount = 0
    const exponentSource = {
      providerKey: 'naver', async inspect() {
        exponentInspectionCount += 1
        return exponentResults
      },
    }
    const exponentCrashWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-exponent-a', leaseMilliseconds: 150_000,
      store: delegate(durableStore, { async complete() {
        throw new Error('simulated crash after exponent checkpoint')
      } }),
      artifacts, source: exponentSource, now: () => now,
    })
    assert.equal((await exponentCrashWorker.runOne()).status, 'deferred')
    const exponentCheckpointBytes = (await database.pool.query(
      `SELECT octet_length(inspection_results::text)::int AS bytes
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [exponentCommand.acquisitionId],
    )).rows[0].bytes
    assert.ok(exponentCheckpointBytes > 8 * 1024 * 1024)
    assert.ok(exponentCheckpointBytes <= 16 * 1024 * 1024)

    now = new Date('2026-09-05T03:19:00.000Z')
    const exponentReplayWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-exponent-b', leaseMilliseconds: 150_000,
      store: durableStore, artifacts, source: exponentSource, now: () => now,
    })
    assert.equal((await exponentReplayWorker.runOne()).status, 'processed')
    assert.equal(exponentInspectionCount, 1)

    const persisted = await database.pool.query(
      `SELECT acquisition.request_fingerprint, item.input_digest
       FROM transfers.web_import_acquisitions AS acquisition
       JOIN transfers.web_import_acquisition_items AS item
         ON item.acquisition_id = acquisition.id
       WHERE acquisition.id = $1::uuid ORDER BY item.source_position`,
      [sharedCommand.acquisitionId],
    )
    assert.match(persisted.rows[0].request_fingerprint, /^[a-f0-9]{64}$/)
    assert.deepEqual(persisted.rows.map((row) => row.input_digest), rawLinks.map(digest))
    assert.equal(JSON.stringify(persisted.rows).includes('naver.me'), false)
    assert.deepEqual((await database.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'transfers'
         AND table_name IN (
           'web_import_acquisitions','web_import_acquisition_items',
           'web_import_acquisition_jobs'
         ) AND column_name ILIKE '%url%'`,
    )).rows, [])

    const disabledRemoteCommand = {
      schemaVersion: 'start-import-acquisition.v1', kind: 'remote-browser',
      commandId: ids[100], acquisitionId: ids[101], importSourceId: ids[102],
      providerKey: 'naver',
    }
    const defaultOffAcquisitions = new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000, now: () => now,
    })
    await assert.rejects(
      defaultOffAcquisitions.start(memberId, disabledRemoteCommand),
      /remote browser acquisition is disabled/,
    )
    assert.deepEqual((await database.pool.query(
      `SELECT
         (SELECT count(*)::int FROM transfers.web_import_acquisitions
          WHERE id = $1::uuid) AS acquisitions,
         (SELECT count(*)::int FROM transfers.import_sources
          WHERE id = $2::uuid) AS sources`,
      [disabledRemoteCommand.acquisitionId, disabledRemoteCommand.importSourceId],
    )).rows, [{ acquisitions: 0, sources: 0 }])

    const remoteCommand = {
      schemaVersion: 'start-import-acquisition.v1',
      kind: 'remote-browser',
      commandId: ids[22], acquisitionId: ids[23], importSourceId: ids[24],
      providerKey: 'naver',
    }
    const remote = await acquisitions.start(memberId, remoteCommand)
    assert.equal(remote.outcome, 'accepted')
    assert.equal(remote.acquisition.state, 'failed')
    assert.deepEqual(remote.acquisition.interaction, { state: 'integration-gated' })
    assert.equal(remote.acquisition.snapshot, undefined)

    const cancelCommandTarget = {
      ...sharedCommand,
      commandId: ids[25], acquisitionId: ids[26], importSourceId: ids[27],
      snapshotId: ids[28],
      links: [{ entryId: ids[29], position: 0, url: 'https://naver.me/CancelLink' }],
    }
    const cancelAcquisition = new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[30], now: () => now,
    })
    const queued = await cancelAcquisition.start(memberId, cancelCommandTarget)
    const cancelArtifact = await capturePath(artifactRoot, ids[30])
    const cancelCommand = {
      schemaVersion: 'import-acquisition-command.v1',
      kind: 'cancel',
      commandId: ids[31],
      acquisitionId: cancelCommandTarget.acquisitionId,
      expectedAcquisitionRevision: queued.acquisition.acquisitionRevision,
    }
    const cancelled = await cancelAcquisition.applyCommand(memberId, cancelCommand)
    assert.equal(cancelled.outcome, 'accepted')
    assert.equal(cancelled.acquisition.state, 'cancelled')
    assert.equal((await cancelAcquisition.applyCommand(memberId, cancelCommand)).status, 'replayed')
    await assert.rejects(access(cancelArtifact))

    const recoveryCommand = {
      ...sharedCommand,
      commandId: ids[32], acquisitionId: ids[33], importSourceId: ids[34],
      snapshotId: ids[35],
      links: [{ entryId: ids[36], position: 0, url: 'https://naver.me/RecoveryLink' }],
    }
    const activationFailureStore = delegate(durableStore, {
      async activate() { throw new Error('simulated activation failure') },
    })
    const recoveryAcquisition = new WebImportAcquisitions({
      store: activationFailureStore,
      artifacts,
      artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[37],
      now: () => now,
    })
    await assert.rejects(recoveryAcquisition.start(memberId, recoveryCommand))
    const recoveryArtifact = await capturePath(artifactRoot, ids[37])
    assert.deepEqual((await database.pool.query(
      'SELECT state FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid',
      [recoveryCommand.acquisitionId],
    )).rows, [{ state: 'preparing' }])
    await access(recoveryArtifact)

    now = new Date('2026-09-05T03:35:00.000Z')
    const expiryWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-expiry', leaseMilliseconds: 150_000,
      store: durableStore, artifacts, source: sharedLinks,
      now: () => now,
    })
    assert.equal((await expiryWorker.runOne()).status, 'expired')
    await assert.rejects(access(recoveryArtifact))
    assert.deepEqual((await database.pool.query(
      `SELECT acquisition.state AS acquisition_state, job.state AS job_state,
              job.artifact_deleted_at IS NOT NULL AS deleted
       FROM transfers.web_import_acquisitions AS acquisition
       JOIN transfers.web_import_acquisition_jobs AS job ON job.acquisition_id = acquisition.id
       WHERE acquisition.id = $1::uuid`,
      [recoveryCommand.acquisitionId],
    )).rows, [{ acquisition_state: 'expired', job_state: 'completed', deleted: true }])

    const fencedCommand = {
      ...sharedCommand,
      commandId: ids[38], acquisitionId: ids[39], importSourceId: ids[40],
      snapshotId: ids[41],
      links: [{ entryId: ids[42], position: 0, url: 'https://naver.me/FencedLink' }],
    }
    const fencedAcquisition = new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[43], now: () => now,
    })
    await fencedAcquisition.start(memberId, fencedCommand)
    const resultFor = (name) => [{
      entryId: fencedCommand.links[0].entryId, position: 0, status: 'succeeded',
      inputUrlDigest: digest(fencedCommand.links[0].url), shareId: 'fenced-share',
      list: {
        sourceListId: 'fenced-share', observedName: name, sourcePosition: 0,
        items: [{
          sourceItemId: 'fenced-bookmark', providerPlaceId: 'fenced-place',
          observedName: name, observedAddress: null, observedCategory: null,
          observedLocation: null, sourcePosition: 0,
        }],
      },
    }]
    let markInspectStarted
    let releaseStaleInspect
    const inspectStarted = new Promise((resolve) => { markInspectStarted = resolve })
    const staleInspection = new Promise((resolve) => { releaseStaleInspect = resolve })
    const staleWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-stale', leaseMilliseconds: 150_000,
      store: durableStore, artifacts,
      source: { providerKey: 'naver', async inspect() {
        markInspectStarted()
        return staleInspection
      } },
      now: () => now,
    })
    const staleRun = staleWorker.runOne()
    await inspectStarted
    now = new Date('2026-09-05T03:38:00.000Z')
    const freshWorker = createWebImportAcquisitionWorker({
      workerId: 'web-worker-fresh', leaseMilliseconds: 150_000,
      store: durableStore, artifacts,
      source: { providerKey: 'naver', async inspect() { return resultFor('fresh result') } },
      now: () => now,
    })
    assert.equal((await freshWorker.runOne()).status, 'processed')
    releaseStaleInspect(resultFor('stale result'))
    assert.equal((await staleRun).status, 'deferred')
    assert.deepEqual((await database.pool.query(
      `SELECT list.observed_name
       FROM transfers.source_snapshot_lists AS list
       WHERE list.snapshot_id = $1::uuid`,
      [fencedCommand.snapshotId],
    )).rows, [{ observed_name: 'fresh result' }])
    assert.deepEqual((await database.pool.query(
      `SELECT state, lease_generation FROM transfers.web_import_acquisition_jobs
       WHERE acquisition_id = $1::uuid`,
      [fencedCommand.acquisitionId],
    )).rows, [{ state: 'completed', lease_generation: '2' }])

    const concurrentCommand = {
      ...sharedCommand,
      commandId: ids[93], acquisitionId: ids[94], importSourceId: ids[95],
      snapshotId: ids[96],
      links: [{ entryId: ids[97], position: 0, url: 'https://naver.me/ConcurrentLink' }],
    }
    let concurrentPutCount = 0
    let markConcurrentPutStarted
    let releaseConcurrentPut
    const concurrentPutStarted = new Promise((resolve) => { markConcurrentPutStarted = resolve })
    const concurrentPutGate = new Promise((resolve) => { releaseConcurrentPut = resolve })
    const delayedArtifacts = {
      reference: (artifactId) => artifacts.reference(artifactId),
      async put(input) {
        concurrentPutCount += 1
        if (concurrentPutCount === 1) {
          markConcurrentPutStarted()
          await concurrentPutGate
        }
        return artifacts.put(input)
      },
      get: (input) => artifacts.get(input),
      discard: (input) => artifacts.discard(input),
    }
    const concurrentAcquisition = new WebImportAcquisitions({
      store: durableStore, artifacts: delayedArtifacts,
      artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[98], now: () => now,
    })
    const delayedStart = concurrentAcquisition.start(otherMemberId, concurrentCommand)
    await concurrentPutStarted
    const concurrentStarted = await concurrentAcquisition.start(otherMemberId, concurrentCommand)
    assert.equal(concurrentStarted.status, 'applied')
    const concurrentArtifact = await capturePath(artifactRoot, ids[98])
    const concurrentCancelled = await concurrentAcquisition.applyCommand(otherMemberId, {
      schemaVersion: 'import-acquisition-command.v1', kind: 'cancel', commandId: ids[99],
      acquisitionId: concurrentCommand.acquisitionId,
      expectedAcquisitionRevision: concurrentStarted.acquisition.acquisitionRevision,
    })
    assert.equal(concurrentCancelled.outcome, 'accepted')
    await assert.rejects(access(concurrentArtifact))
    releaseConcurrentPut()
    const delayedReplay = await delayedStart
    assert.equal(delayedReplay.status, 'replayed')
    await assert.rejects(access(concurrentArtifact))
    assert.deepEqual((await database.pool.query(
      `SELECT state, artifact_deleted_at IS NOT NULL AS deleted
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [concurrentCommand.acquisitionId],
    )).rows, [{ state: 'cancelled', deleted: true }])

    const limitedCommand = (offset, url) => ({
      ...sharedCommand,
      commandId: ids[offset], acquisitionId: ids[offset + 1],
      importSourceId: ids[offset + 2], snapshotId: ids[offset + 3],
      links: [{ entryId: ids[offset + 4], position: 0, url }],
    })
    const limitCases = [
      { command: limitedCommand(44, 'https://naver.me/LimitA'), artifactId: ids[49] },
      { command: limitedCommand(50, 'https://naver.me/LimitB'), artifactId: ids[55] },
      { command: limitedCommand(104, 'https://naver.me/LimitC'), artifactId: ids[109] },
      { command: limitedCommand(110, 'https://naver.me/LimitD'), artifactId: ids[115] },
    ]
    const limitApplications = limitCases.map(({ artifactId }) => new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => artifactId, now: () => now,
    }))
    const raced = await Promise.all(limitCases.map(({ command }, index) =>
      limitApplications[index].start(memberId, command)))
    assert.equal(raced.filter((result) => result.outcome === 'accepted').length, 3)
    assert.equal(raced.filter((result) => result.outcome === 'rejected').length, 1)
    const rejectedLimit = raced.find((result) => result.outcome === 'rejected')
    assert.equal(rejectedLimit.rejection.code, 'limit-exceeded')

    const concurrentClaims = await Promise.all([
      durableStore.claim({
        workerId: 'web-worker-member-serial-a', claimedAt: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 150_000).toISOString(),
      }),
      durableStore.claim({
        workerId: 'web-worker-member-serial-b', claimedAt: now.toISOString(),
        leaseUntil: new Date(now.getTime() + 150_000).toISOString(),
      }),
    ])
    assert.equal(concurrentClaims.filter((claim) => claim !== undefined).length, 1)
    const firstLimitClaim = concurrentClaims.find((claim) => claim !== undefined)
    assert.equal(firstLimitClaim.ownerMemberId, memberId)
    await durableStore.expire({ claim: firstLimitClaim, expiredAt: now.toISOString() })
    await artifacts.discard({
      reference: firstLimitClaim.artifact.reference,
      batchId: firstLimitClaim.acquisitionId,
      providerKey: firstLimitClaim.providerKey,
    })
    await durableStore.markArtifactDeleted(firstLimitClaim.acquisitionId, now.toISOString())

    const queuedWinners = raced
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.outcome === 'accepted' &&
        result.acquisition.acquisitionId !== firstLimitClaim.acquisitionId)
    for (const [{ result, index }, commandId] of queuedWinners.map((winner, index) => (
      [winner, [ids[60], ids[116]][index]]
    ))) {
      const cancelledLimit = await limitApplications[index].applyCommand(memberId, {
        schemaVersion: 'import-acquisition-command.v1', kind: 'cancel', commandId,
        acquisitionId: result.acquisition.acquisitionId,
        expectedAcquisitionRevision: result.acquisition.acquisitionRevision,
      })
      assert.equal(cancelledLimit.outcome, 'accepted')
    }

    const afterLimit = limitedCommand(61, 'https://naver.me/AfterLimit')
    const afterLimitAcquisition = new WebImportAcquisitions({
      store: durableStore, artifacts, artifactRetentionMilliseconds: 900_000,
      nextArtifactId: () => ids[66], now: () => now,
    })
    const restarted = await afterLimitAcquisition.start(memberId, afterLimit)
    assert.equal(restarted.outcome, 'accepted')
    assert.equal(restarted.acquisition.state, 'processing')
  } finally {
    await database.close()
    await rm(artifactRoot, { recursive: true, force: true })
  }
})
