import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectorCaptureChunk,
  connectorCaptureManifest,
  connectorCapturePayload,
  emptyConnectorCapturePayload,
  startReadyTransferOperationsFixture,
  transferOperationDigest,
  transferOperationEvidence,
  transferOperationId,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('connector captures enforce exact grants, immutable chunks, cancellation, and expiry', {
  timeout: 240_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-transfer-connector-capture',
  )
  const { database, transfersModule, connectorCapture, verifiedConnection } = fixture
  const { memberId, otherMemberId, connectionId } = transferOperationIds
  const { accountFingerprint, placeOrigin, at } = transferOperationEvidence

  try {
    await assert.rejects(
      database.pool.query(
        `INSERT INTO transfers.operations (
           id, owner_membership_id, kind, provider_key, connection_id, account_label,
           resource_kind, resource_id, stage, state, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'import-capture','naver',$3::uuid,'wrong owner',
           'snapshot',$4::uuid,'awaiting-connector','queued',$5::timestamptz,$5::timestamptz)`,
        [transferOperationId(98), otherMemberId, connectionId, transferOperationId(99), at],
      ),
      { code: '23503' },
    )

    let connectorId = 200
    let connectorToken = 0
    const receiver = new transfersModule.PostgresConnectorCaptures(database.pool, {
      grantTtlMilliseconds: 300_000,
      maximumChunkBytes: 4_194_304,
      nextId: () => transferOperationId(connectorId++),
      nextToken: () => `connector-token-${++connectorToken}`,
      now: () => new Date('2026-09-03T02:00:03.000Z'),
    })

    const bulkOperationId = transferOperationId(300)
    const bulkManifestId = transferOperationId(301)
    const bulkInstallationId = transferOperationId(302)
    const payloads = Array.from({ length: 11 }, (_, sequence) => {
      const count = sequence === 10 ? 1 : 1_000
      const payload = connectorCapturePayload(sequence * 1_000, count)
      return { payload, ...connectorCaptureChunk(sequence, payload, count) }
    })
    const bulkManifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId: bulkOperationId,
      manifestId: bulkManifestId,
      installationId: bulkInstallationId,
      sourceRevision: 'bulk-source-revision-1',
      chunks: payloads,
      listCount: 1,
      itemCount: 10_001,
      provenance: {
        acquisitionKind: 'browser-network',
        parserVersion: 'test-naver-saved-place.v1',
      },
    })
    const rejectedFingerprint = await receiver.issueImportGrant(memberId, {
      commandId: transferOperationId(303),
      operationId: bulkOperationId,
      connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint: 'b'.repeat(64),
      installationId: bulkInstallationId,
      placeOrigin,
      manifest: bulkManifest,
    })
    assert.deepEqual(rejectedFingerprint.rejection, { code: 'revision-conflict' })

    const bulkGrant = await receiver.issueImportGrant(memberId, {
      commandId: transferOperationId(304),
      operationId: bulkOperationId,
      connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint,
      installationId: bulkInstallationId,
      placeOrigin,
      manifest: bulkManifest,
    })
    assert.equal(bulkGrant.status, 'applied')
    assert.equal(bulkGrant.value.accountFingerprint, accountFingerprint)
    const storedConnectorToken = (await database.pool.query(
      'SELECT token_digest FROM transfers.connector_import_grants WHERE grant_id = $1::uuid',
      [bulkGrant.value.grantId],
    )).rows[0].token_digest
    assert.equal(storedConnectorToken, transferOperationDigest(bulkGrant.value.token))
    assert.notEqual(storedConnectorToken, bulkGrant.value.token)

    const incomplete = await receiver.complete({
      token: bulkGrant.value.token,
      sourceOrigin: placeOrigin,
      operationId: bulkOperationId,
      manifest: bulkManifest,
    })
    assert.equal(incomplete.outcome, 'incomplete')
    assert.deepEqual(incomplete.missingSequences, Array.from({ length: 11 }, (_, value) => value))
    await assert.rejects(
      receiver.recordChunk({
        token: bulkGrant.value.token,
        sourceOrigin: placeOrigin,
        chunk: {
          operationId: bulkOperationId,
          manifestId: bulkManifestId,
          ...payloads[1],
        },
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )

    const firstChunk = {
      token: bulkGrant.value.token,
      sourceOrigin: placeOrigin,
      chunk: {
        operationId: bulkOperationId,
        manifestId: bulkManifestId,
        ...payloads[0],
      },
    }
    assert.equal((await receiver.recordChunk(firstChunk)).outcome, 'recorded')
    assert.equal((await receiver.recordChunk(firstChunk)).outcome, 'replayed')
    const conflictingPayload = connectorCapturePayload(20_000, 1_000)
    await assert.rejects(
      receiver.recordChunk({
        token: bulkGrant.value.token,
        sourceOrigin: placeOrigin,
        chunk: {
          operationId: bulkOperationId,
          manifestId: bulkManifestId,
          payload: conflictingPayload,
          ...connectorCaptureChunk(0, conflictingPayload, 1_000),
        },
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    for (const item of payloads.slice(1)) {
      const recorded = await receiver.recordChunk({
        token: bulkGrant.value.token,
        sourceOrigin: placeOrigin,
        chunk: {
          operationId: bulkOperationId,
          manifestId: bulkManifestId,
          ...item,
        },
      })
      assert.equal(recorded.outcome, 'recorded')
    }
    const bulkCompleted = await receiver.complete({
      token: bulkGrant.value.token,
      sourceOrigin: placeOrigin,
      operationId: bulkOperationId,
      manifest: bulkManifest,
    })
    assert.equal(bulkCompleted.outcome, 'completed')
    assert.equal((await database.pool.query(
      'SELECT count(*)::int AS count FROM transfers.source_snapshot_items WHERE snapshot_id = $1::uuid',
      [bulkManifestId],
    )).rows[0].count, 10_001)
    assert.deepEqual((await database.pool.query(
      `SELECT acquisition_kind, parser_version
       FROM transfers.source_snapshots WHERE id = $1::uuid`,
      [bulkManifestId],
    )).rows[0], {
      acquisition_kind: 'browser-network',
      parser_version: 'test-naver-saved-place.v1',
    })

    const badDigestOperationId = transferOperationId(310)
    const badDigestManifestId = transferOperationId(311)
    const badDigestInstallationId = transferOperationId(312)
    const badDigestPayload = emptyConnectorCapturePayload()
    const badDigestChunk = {
      payload: badDigestPayload,
      ...connectorCaptureChunk(0, badDigestPayload, 0),
    }
    const badDigestManifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId: badDigestOperationId,
      manifestId: badDigestManifestId,
      installationId: badDigestInstallationId,
      sourceRevision: 'bad-digest-source-revision',
      chunks: [badDigestChunk],
      listCount: 0,
      itemCount: 0,
      digest: 'f'.repeat(64),
    })
    const badDigestGrant = await receiver.issueImportGrant(memberId, {
      commandId: transferOperationId(313),
      operationId: badDigestOperationId,
      connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint,
      installationId: badDigestInstallationId,
      placeOrigin,
      manifest: badDigestManifest,
    })
    await receiver.recordChunk({
      token: badDigestGrant.value.token,
      sourceOrigin: placeOrigin,
      chunk: {
        operationId: badDigestOperationId,
        manifestId: badDigestManifestId,
        ...badDigestChunk,
      },
    })
    await assert.rejects(
      receiver.complete({
        token: badDigestGrant.value.token,
        sourceOrigin: placeOrigin,
        operationId: badDigestOperationId,
        manifest: badDigestManifest,
      }),
      /manifest digest mismatch/,
    )

    const cancellableOperationId = transferOperationId(320)
    const cancellableManifestId = transferOperationId(321)
    const cancellableInstallationId = transferOperationId(322)
    const cancellablePayload = emptyConnectorCapturePayload()
    const cancellableChunk = {
      payload: cancellablePayload,
      ...connectorCaptureChunk(0, cancellablePayload, 0),
    }
    const cancellableManifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId: cancellableOperationId,
      manifestId: cancellableManifestId,
      installationId: cancellableInstallationId,
      sourceRevision: 'cancellable-source-revision',
      chunks: [cancellableChunk],
      listCount: 0,
      itemCount: 0,
    })
    await receiver.issueImportGrant(memberId, {
      commandId: transferOperationId(323),
      operationId: cancellableOperationId,
      connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint,
      installationId: cancellableInstallationId,
      placeOrigin,
      manifest: cancellableManifest,
    })
    const operations = new transfersModule.PostgresTransferOperations(
      database.pool,
      () => new Date('2026-09-03T02:00:04.000Z'),
    )
    const cancellable = await operations.get(memberId, cancellableOperationId)
    await assert.rejects(
      database.pool.query(
        `UPDATE transfers.connector_capture_manifests
         SET completed_at = captured_at - interval '1 millisecond'
         WHERE manifest_id = $1::uuid`,
        [cancellableManifestId],
      ),
      { code: '23514' },
    )
    assert.equal(await operations.get(otherMemberId, cancellableOperationId), undefined)
    assert.equal((await operations.command(otherMemberId, {
      commandId: transferOperationId(324),
      operationId: cancellableOperationId,
      expectedOperationRevision: cancellable.operationRevision,
      action: 'cancel',
    })).rejection.code, 'not-found')
    assert.equal((await operations.command(memberId, {
      commandId: transferOperationId(325),
      operationId: cancellableOperationId,
      expectedOperationRevision: 'transfer-operation-revision.v1.invalid',
      action: 'cancel',
    })).rejection.code, 'revision-conflict')
    const cancelled = await operations.command(memberId, {
      commandId: transferOperationId(326),
      operationId: cancellableOperationId,
      expectedOperationRevision: cancellable.operationRevision,
      action: 'cancel',
    })
    assert.equal(cancelled.status, 'applied')
    assert.equal(cancelled.value.state, 'cancelled')

    let captureNow = new Date('2026-09-03T02:01:00.000Z')
    const expiringReceiver = new transfersModule.PostgresConnectorCaptures(database.pool, {
      grantTtlMilliseconds: 1_000,
      maximumChunkBytes: 4_194_304,
      nextId: () => transferOperationId(connectorId++),
      nextToken: () => `expiring-connector-token-${++connectorToken}`,
      now: () => captureNow,
    })
    const expiringOperations = new transfersModule.PostgresTransferOperations(
      database.pool,
      () => captureNow,
    )
    const expiringPayload = emptyConnectorCapturePayload()
    const expiringChunk = {
      payload: expiringPayload,
      ...connectorCaptureChunk(0, expiringPayload, 0),
    }
    const expiringOperationId = transferOperationId(330)
    const expiringManifestId = transferOperationId(331)
    const expiringInstallationId = transferOperationId(332)
    const expiringManifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId: expiringOperationId,
      manifestId: expiringManifestId,
      installationId: expiringInstallationId,
      sourceRevision: 'expiring-source-revision',
      chunks: [expiringChunk],
      listCount: 0,
      itemCount: 0,
      provenance: {
        acquisitionKind: 'browser-network',
        parserVersion: 'test-naver-saved-place.v1',
      },
    })
    const expiringGrantRequest = {
      commandId: transferOperationId(333),
      operationId: expiringOperationId,
      connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver',
      accountFingerprint,
      installationId: expiringInstallationId,
      placeOrigin,
      manifest: expiringManifest,
    }
    assert.equal((await expiringReceiver.issueImportGrant(
      memberId,
      expiringGrantRequest,
    )).status, 'applied')
    captureNow = new Date('2026-09-03T02:01:02.000Z')
    assert.equal(await expiringReceiver.sweepExpiredCaptures(10), 1)
    const expiredOperation = await expiringOperations.get(memberId, expiringOperationId)
    assert.equal(expiredOperation.state, 'failed')
    assert.deepEqual(expiredOperation.allowedActions, ['retry'])
    assert.deepEqual(expiredOperation.lastError, {
      code: 'connector-grant-expired',
      retryable: true,
    })
    assert.equal((await expiringReceiver.issueImportGrant(
      memberId,
      expiringGrantRequest,
    )).rejection.code, 'not-approvable')
    const retriedCapture = await expiringOperations.command(memberId, {
      commandId: transferOperationId(334),
      operationId: expiringOperationId,
      expectedOperationRevision: expiredOperation.operationRevision,
      action: 'retry',
    })
    assert.equal(retriedCapture.value.state, 'queued')
    assert.equal((await expiringReceiver.issueImportGrant(memberId, {
      ...expiringGrantRequest,
      commandId: transferOperationId(335),
    })).status, 'applied')
    assert.deepEqual((await database.pool.query(
      `SELECT manifest.status, operation.state
       FROM transfers.connector_capture_manifests AS manifest
       JOIN transfers.operations AS operation ON operation.id = manifest.operation_id
       WHERE manifest.manifest_id = $1::uuid`,
      [expiringManifestId],
    )).rows[0], { status: 'receiving', state: 'queued' })
  } finally {
    await fixture.close()
  }
})
