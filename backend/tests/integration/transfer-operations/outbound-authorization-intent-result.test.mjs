import assert from 'node:assert/strict'
import test from 'node:test'

import {
  startReadyTransferOperationsFixture,
  transferOperationEvidence,
  transferOperationId,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('outbound execution binds authorization, prepared intent, and reported result exactly', {
  timeout: 240_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-transfer-outbound-authorization',
  )
  const { database, transfersModule, transfers, sourceCollection } = fixture
  const { memberId, connectionId, collectionId, placeId } = transferOperationIds
  const { accountFingerprint, placeOrigin } = transferOperationEvidence

  try {
    assert.deepEqual((await database.pool.query(
      `SELECT connection.state, observation.account_fingerprint
       FROM transfers.provider_connections AS connection
       JOIN transfers.connection_observations AS observation
         ON observation.connection_id = connection.id
        AND observation.observed_state = 'ready'
       WHERE connection.id = $1::uuid`,
      [connectionId],
    )).rows, [{ state: 'ready', account_fingerprint: accountFingerprint }])

    const preview = await transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2',
      kind: 'preview',
      commandId: transferOperationId(400),
      transferId: transferOperationId(401),
      connectionId,
      collectionId,
      expectedCollectionRevision: sourceCollection.collectionVersion,
      selection: { kind: 'all' },
      target: { kind: 'new-list', name: '네이버로 내보내기' },
    })
    assert.equal(preview.status, 'applied')
    const approved = await transfers.applyOutboundTransferCommand(memberId, {
      schemaVersion: 'outbound-transfer-command.v2',
      kind: 'approve',
      commandId: transferOperationId(402),
      transferId: transferOperationId(401),
      expectedTransferRevision: preview.value.transferRevision,
    })
    assert.equal(approved.status, 'applied', JSON.stringify(approved))
    assert.equal(approved.value.state, 'approved')

    const operations = new transfersModule.PostgresTransferOperations(
      database.pool,
      () => new Date('2026-09-03T02:00:04.000Z'),
    )
    let outboundId = 500
    let outboundToken = 0
    const outbound = new transfersModule.PostgresOutboundExecutions(database.pool, operations, {
      grantTtlMilliseconds: 300_000,
      receiptTtlMilliseconds: 300_000,
      maximumBytes: 1_048_576,
      maximumBatches: 10,
      nextId: () => transferOperationId(outboundId++),
      nextToken: () => `outbound-token-${++outboundToken}`,
      now: () => new Date('2026-09-03T02:00:05.000Z'),
    })
    const rejectedOutboundFingerprint = await outbound.issueGrant(memberId, {
      commandId: transferOperationId(403),
      transferId: transferOperationId(401),
      expectedTransferRevision: approved.value.transferRevision,
      installationId: transferOperationId(404),
      accountFingerprint: 'b'.repeat(64),
      placeOrigin,
    })
    assert.deepEqual(rejectedOutboundFingerprint.rejection, { code: 'revision-conflict' })
    const executionGrant = await outbound.issueGrant(memberId, {
      commandId: transferOperationId(405),
      transferId: transferOperationId(401),
      expectedTransferRevision: approved.value.transferRevision,
      installationId: transferOperationId(404),
      accountFingerprint,
      placeOrigin,
    })
    assert.equal(executionGrant.status, 'applied')
    const consumeRequest = {
      grantId: executionGrant.value.grantId,
      operationId: executionGrant.value.operationId,
      connectionId,
      providerKey: 'naver',
      accountFingerprint,
      installationId: transferOperationId(404),
      planDigest: executionGrant.value.planDigest,
      sourceOrigin: placeOrigin,
      itemCount: 1,
      byteCount: 128,
      batchCount: 1,
      batchSize: 1,
    }
    await assert.rejects(
      outbound.consume({ token: 'wrong-token', request: consumeRequest }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    const firstReceipt = await outbound.consume({
      token: executionGrant.value.token,
      request: consumeRequest,
    })
    assert.equal(firstReceipt.status, 'consumed')
    await assert.rejects(
      outbound.consume({
        token: executionGrant.value.token,
        request: { ...consumeRequest, itemCount: 0, batchCount: 0 },
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    const replayedReceipt = await outbound.consume({
      token: executionGrant.value.token,
      request: consumeRequest,
    })
    assert.equal(replayedReceipt.status, 'replayed')
    assert.equal(replayedReceipt.receiptReference, firstReceipt.receiptReference)
    assert.notEqual(replayedReceipt.receiptToken, firstReceipt.receiptToken)

    const createTargetAttempt = {
      operationId: executionGrant.value.operationId,
      receiptReference: replayedReceipt.receiptReference,
      attemptId: transferOperationId(406),
      phase: 'create-target-list',
      targetListId: 'naver-target-list-1',
      sequence: 0,
      final: true,
      outcome: 'completed',
      reconciliationReference: null,
      items: [],
    }
    await outbound.prepareAttempt({
      receiptToken: replayedReceipt.receiptToken,
      sourceOrigin: placeOrigin,
      intent: {
        operationId: createTargetAttempt.operationId,
        receiptReference: createTargetAttempt.receiptReference,
        attemptId: createTargetAttempt.attemptId,
        phase: createTargetAttempt.phase,
        targetListId: null,
        sequence: createTargetAttempt.sequence,
        final: createTargetAttempt.final,
        reconciliationReference: 'prepared-create-target-1',
        items: [],
      },
    })
    await assert.rejects(
      outbound.recordAttempt({
        receiptToken: firstReceipt.receiptToken,
        sourceOrigin: placeOrigin,
        attempt: createTargetAttempt,
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    assert.equal((await outbound.recordAttempt({
      receiptToken: replayedReceipt.receiptToken,
      sourceOrigin: placeOrigin,
      attempt: createTargetAttempt,
    })).outcome, 'recorded')

    const addItemsAttempt = {
      operationId: executionGrant.value.operationId,
      receiptReference: replayedReceipt.receiptReference,
      attemptId: transferOperationId(407),
      phase: 'add-items',
      targetListId: 'naver-target-list-1',
      sequence: 0,
      final: true,
      outcome: 'completed',
      reconciliationReference: null,
      items: [{
        itemKey: placeId,
        targetReference: `naver-${placeId}`,
        status: 'applied',
        code: null,
        retryable: null,
        reconciliationReference: null,
      }],
    }
    await assert.rejects(
      outbound.prepareAttempt({
        receiptToken: replayedReceipt.receiptToken,
        sourceOrigin: placeOrigin,
        intent: {
          operationId: addItemsAttempt.operationId,
          receiptReference: addItemsAttempt.receiptReference,
          attemptId: transferOperationId(408),
          phase: 'add-items',
          targetListId: 'naver-target-list-1',
          sequence: 0,
          final: true,
          reconciliationReference: 'prepared-wrong-batch',
          items: [{ itemKey: placeId, targetReference: 'wrong-provider-reference' }],
        },
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    await outbound.prepareAttempt({
      receiptToken: replayedReceipt.receiptToken,
      sourceOrigin: placeOrigin,
      intent: {
        operationId: addItemsAttempt.operationId,
        receiptReference: addItemsAttempt.receiptReference,
        attemptId: addItemsAttempt.attemptId,
        phase: addItemsAttempt.phase,
        targetListId: addItemsAttempt.targetListId,
        sequence: addItemsAttempt.sequence,
        final: addItemsAttempt.final,
        reconciliationReference: 'prepared-add-items-1',
        items: addItemsAttempt.items.map((item) => ({
          itemKey: item.itemKey,
          targetReference: item.targetReference,
        })),
      },
    })
    const recordedAttempt = await outbound.recordAttempt({
      receiptToken: replayedReceipt.receiptToken,
      sourceOrigin: placeOrigin,
      attempt: addItemsAttempt,
    })
    assert.equal(recordedAttempt.outcome, 'recorded')
    assert.equal(recordedAttempt.operation.state, 'completed')
    assert.equal(recordedAttempt.operation.stage, 'externally-completed')
  } finally {
    await fixture.close()
  }
})
