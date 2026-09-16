import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectorCaptureChunk,
  connectorCaptureManifest,
  emptyConnectorCapturePayload,
  startReadyTransferOperationsFixture,
  transferOperationEvidence,
  transferOperationId as id,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

for (const change of ['revoke', 'request-reauthorization', 'account-change', 'action-required']) {
  test(`connection ${change} invalidates existing capture status, upload and complete`, {
    timeout: 120_000,
  }, async () => {
    const fixture = await startReadyTransferOperationsFixture(`gotgotgan-grant-${change}`)
    const { database, transfers, transfersModule, connectorCapture, verifiedConnection } = fixture
    const { memberId, connectionId } = transferOperationIds
    const { accountFingerprint, placeOrigin } = transferOperationEvidence
    let sequence = 850
    const receiver = new transfersModule.PostgresConnectorCaptures(database.pool, {
      grantTtlMilliseconds: 300_000, maximumChunkBytes: 4_194_304,
      nextId: () => id(sequence++), nextToken: () => `revocation-token-${sequence++}`,
      now: () => new Date('2026-09-03T02:00:03.000Z'),
    })
    try {
      const payload = emptyConnectorCapturePayload()
      const descriptor = connectorCaptureChunk(0, payload, 0)
      const manifest = connectorCaptureManifest({
        captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
        operationId: id(800), manifestId: id(801), installationId: id(802),
        sourceRevision: 'revocation-source', chunks: [descriptor], listCount: 0, itemCount: 0,
      })
      const request = {
        commandId: id(803), operationId: id(800), connectionId,
        expectedConnectionRevision: verifiedConnection.value.connectionRevision,
        providerKey: 'naver', accountFingerprint, installationId: id(802), placeOrigin, manifest,
      }
      const granted = await receiver.issueImportGrant(memberId, request)
      assert.equal(granted.status, 'applied')
      const credentials = { token: granted.value.token, sourceOrigin: placeOrigin, operationId: id(800) }
      const chunk = { operationId: id(800), manifestId: id(801), payload, ...descriptor }
      await receiver.recordChunk({ ...credentials, chunk })
      assert.equal((await receiver.status({ ...credentials, manifestId: id(801) })).state, 'receiving')

      const changed = change === 'account-change' || change === 'action-required'
        ? await transfers.recordConnectionObservation({
            observationId: id(804), ownerMemberId: memberId, connectionId,
            expectedConnectionRevision: verifiedConnection.value.connectionRevision,
            observedState: change === 'account-change' ? 'ready' : 'action-required',
            accountFingerprint: change === 'account-change' ? 'b'.repeat(64) : accountFingerprint,
            observedAt: '2026-09-03T02:00:04.000Z',
          })
        : await transfers.applyConnectionCommand(memberId, {
            schemaVersion: 'provider-connection-command.v2', kind: change,
            commandId: id(804), connectionId,
            expectedConnectionRevision: verifiedConnection.value.connectionRevision,
          })
      assert.equal(changed.status, 'applied')
      const results = []
      for (const action of [
        () => receiver.status({ ...credentials, manifestId: id(801) }),
        () => receiver.recordChunk({ ...credentials, chunk }),
        () => receiver.complete({ ...credentials, manifest }),
      ]) {
        try { await action(); results.push('accepted') } catch (error) {
          assert.equal(error.name, 'ConnectorTransferAuthorizationError')
          results.push('rejected')
        }
      }
      assert.deepEqual(results, ['rejected', 'rejected', 'rejected'])
      assert.deepEqual((await database.pool.query(
        `SELECT status FROM transfers.connector_import_grants WHERE grant_id = $1::uuid`,
        [granted.value.grantId],
      )).rows, [{ status: 'revoked' }])
      assert.equal((await database.pool.query(
        'SELECT count(*)::int AS count FROM transfers.source_snapshots',
      )).rows[0].count, 0)
      const reconnected = await transfers.recordConnectionObservation({
        observationId: id(805), ownerMemberId: memberId, connectionId,
        expectedConnectionRevision: changed.value.connectionRevision,
        observedState: 'ready', accountFingerprint,
        observedAt: '2026-09-03T02:00:05.000Z',
      })
      if (change === 'revoke') {
        assert.equal(reconnected.status, 'rejected')
        assert.equal((await receiver.issueImportGrant(memberId, request)).status, 'rejected')
      } else {
        assert.equal(reconnected.status, 'applied')
        await assert.rejects(receiver.status({ ...credentials, manifestId: id(801) }),
          { name: 'ConnectorTransferAuthorizationError' })
        assert.equal((await receiver.issueImportGrant(memberId, request)).status, 'rejected')
        const renewed = await receiver.issueImportGrant(memberId, {
          ...request, commandId: id(806),
          expectedConnectionRevision: reconnected.value.connectionRevision,
        })
        assert.equal(renewed.status, 'applied')
        assert.notEqual(renewed.value.token, granted.value.token)
        const newCredentials = { ...credentials, token: renewed.value.token }
        assert.equal((await receiver.status({ ...newCredentials, manifestId: id(801) })).nextSequence, 1)
        if (change === 'request-reauthorization') {
          const oldCommandReplay = await transfers.applyConnectionCommand(memberId, {
            schemaVersion: 'provider-connection-command.v2', kind: change, commandId: id(804),
            connectionId, expectedConnectionRevision: verifiedConnection.value.connectionRevision,
          })
          assert.equal(oldCommandReplay.status, 'replayed')
          assert.equal(oldCommandReplay.value.state, 'ready')
        }
        const reaffirmed = await transfers.recordConnectionObservation({
          observationId: id(807), ownerMemberId: memberId, connectionId,
          expectedConnectionRevision: reconnected.value.connectionRevision,
          observedState: 'ready', accountFingerprint,
          observedAt: '2026-09-03T02:00:06.000Z',
        })
        assert.equal(reaffirmed.status, 'applied')
        const renamed = await transfers.applyConnectionCommand(memberId, {
          schemaVersion: 'provider-connection-command.v2', kind: 'rename', commandId: id(808),
          connectionId, expectedConnectionRevision: reaffirmed.value.connectionRevision, label: '새 연결 이름',
        })
        assert.equal(renamed.status, 'applied')
        assert.equal((await receiver.complete({ ...newCredentials, manifest })).outcome, 'completed')
        await assert.rejects(receiver.complete({ ...credentials, manifest }),
          { name: 'ConnectorTransferAuthorizationError' })
        assert.equal((await transfers.applyConnectionCommand(memberId, {
          schemaVersion: 'provider-connection-command.v2', kind: 'revoke', commandId: id(809),
          connectionId, expectedConnectionRevision: renamed.value.connectionRevision,
        })).status, 'applied')
        for (const action of [
          () => receiver.status({ ...newCredentials, manifestId: id(801) }),
          () => receiver.recordChunk({ ...newCredentials, chunk }),
          () => receiver.complete({ ...newCredentials, manifest }),
        ]) await assert.rejects(action(), { name: 'ConnectorTransferAuthorizationError' })
        assert.equal((await database.pool.query(
          'SELECT count(*)::int AS count FROM transfers.source_snapshots',
        )).rows[0].count, 1)
      }
    } finally { await fixture.close() }
  })
}

test('revocation waits for an already authorized capture and prevents every later replay', {
  timeout: 120_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture('gotgotgan-grant-revocation-race')
  const { database, transfersModule, connectorCapture, verifiedConnection, collectionReader } = fixture
  const { memberId, connectionId } = transferOperationIds
  const { accountFingerprint, placeOrigin } = transferOperationEvidence
  function deferred() {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    return { promise, resolve }
  }
  const captureLocked = deferred()
  const releaseCapture = deferred()
  const revokeAttempted = deferred()
  let held = false
  const barrierPool = {
    query: (...args) => database.pool.query(...args),
    async connect() {
      const client = await database.pool.connect()
      return {
        async query(...args) {
          const statement = args[0]
          const pending = client.query(...args)
          if (statement.includes('UPDATE transfers.connector_import_grants SET status') &&
            statement.includes('WHERE connection_id')) revokeAttempted.resolve()
          const result = await pending
          if (!held && statement.includes('WHERE issued_grant.token_digest') &&
            statement.includes('FOR UPDATE')) {
            held = true
            captureLocked.resolve()
            await releaseCapture.promise
          }
          return result
        },
        release: () => client.release(),
      }
    },
  }
  async function bounded(promise) {
    let timeout
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('capture revocation barrier timed out')), 5_000)
      })])
    } finally { clearTimeout(timeout) }
  }
  try {
    const options = {
      grantTtlMilliseconds: 300_000, maximumChunkBytes: 4_194_304,
      nextId: () => id(901), nextToken: () => 'revocation-race-token',
      now: () => new Date('2026-09-03T02:00:03.000Z'),
    }
    const receiver = new transfersModule.PostgresConnectorCaptures(database.pool, options)
    const heldReceiver = new transfersModule.PostgresConnectorCaptures(barrierPool, options)
    const payload = emptyConnectorCapturePayload()
    const descriptor = connectorCaptureChunk(0, payload, 0)
    const manifest = connectorCaptureManifest({
      captureManifestDigestInput: connectorCapture.captureManifestDigestInput,
      operationId: id(902), manifestId: id(903), installationId: id(904),
      sourceRevision: 'revocation-race', chunks: [descriptor], listCount: 0, itemCount: 0,
    })
    const grant = await receiver.issueImportGrant(memberId, {
      commandId: id(905), operationId: id(902), connectionId,
      expectedConnectionRevision: verifiedConnection.value.connectionRevision,
      providerKey: 'naver', accountFingerprint, installationId: id(904), placeOrigin, manifest,
    })
    assert.equal(grant.status, 'applied')
    const credentials = { token: grant.value.token, sourceOrigin: placeOrigin,
      operationId: id(902), manifestId: id(903) }
    await receiver.recordChunk({ ...credentials, chunk: {
      operationId: id(902), manifestId: id(903), payload, ...descriptor,
    } })
    const activeCapture = heldReceiver.complete({ ...credentials, manifest })
    void activeCapture.catch(() => undefined)
    await bounded(captureLocked.promise)
    const transfers = new transfersModule.PostgresProviderTransfers({
      pool: barrierPool, collections: collectionReader,
      now: () => new Date('2026-09-03T02:00:04.000Z'),
    })
    let revocationFinished = false
    const revoke = transfers.applyConnectionCommand(memberId, {
      schemaVersion: 'provider-connection-command.v2', kind: 'revoke', commandId: id(906),
      connectionId, expectedConnectionRevision: verifiedConnection.value.connectionRevision,
    }).then((result) => { revocationFinished = true; return result })
    void revoke.catch(() => undefined)
    await bounded(revokeAttempted.promise)
    assert.equal(revocationFinished, false)
    releaseCapture.resolve()
    assert.equal((await bounded(activeCapture)).outcome, 'completed')
    assert.equal((await bounded(revoke)).status, 'applied')
    await assert.rejects(receiver.status(credentials), { name: 'ConnectorTransferAuthorizationError' })
  } finally {
    releaseCapture.resolve()
    await fixture.close()
  }
})
