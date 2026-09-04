import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOutboundExecutionTestDriver,
  startReadyTransferOperationsFixture,
  transferOperationEvidence,
  transferOperationIds,
} from './transfer-operations-postgres-fixture.mjs'

test('outbound execution preserves failure, cancellation, expiry, and reconciliation truth', {
  timeout: 240_000,
}, async () => {
  const fixture = await startReadyTransferOperationsFixture(
    'gotgotgan-transfer-outbound-reconciliation',
  )
  const { database, transfersModule } = fixture
  const { memberId, placeId } = transferOperationIds
  const { placeOrigin } = transferOperationEvidence
  const driver = createOutboundExecutionTestDriver(fixture)
  const {
    operations, outbound, nextId, openExecution, prepareAttempt, recordPreparedAttempt,
  } = driver

  try {
    const retryableCreate = await openExecution({ kind: 'new-list', name: '재시도 대상' })
    const retryableFailure = await recordPreparedAttempt(retryableCreate, {
      operationId: retryableCreate.grant.operationId,
      receiptReference: retryableCreate.receipt.receiptReference,
      attemptId: nextId(),
      phase: 'create-target-list',
      targetListId: null,
      sequence: 0,
      final: true,
      outcome: 'partial',
      reconciliationReference: null,
      problem: {
        code: 'provider-temporary-failure',
        retryable: true,
        actionRequired: null,
      },
      items: [],
    })
    assert.equal(retryableFailure.operation.state, 'partial-failure')
    assert.deepEqual(retryableFailure.operation.allowedActions, ['cancel'])
    assert.deepEqual(retryableFailure.operation.lastError, {
      code: 'provider-temporary-failure',
      retryable: true,
    })
    const cancelledRetry = await operations.command(memberId, {
      commandId: nextId(),
      operationId: retryableCreate.grant.operationId,
      expectedOperationRevision: retryableFailure.operation.operationRevision,
      action: 'cancel',
    })
    assert.equal(cancelledRetry.value.state, 'cancelled')

    const actionRequiredExecution = await openExecution({
      kind: 'new-list',
      name: '재인증 대상',
    })
    const actionRequiredCreate = await recordPreparedAttempt(actionRequiredExecution, {
      operationId: actionRequiredExecution.grant.operationId,
      receiptReference: actionRequiredExecution.receipt.receiptReference,
      attemptId: nextId(),
      phase: 'create-target-list',
      targetListId: null,
      sequence: 0,
      final: true,
      outcome: 'partial',
      reconciliationReference: null,
      problem: {
        code: 'provider-reauthentication-required',
        retryable: false,
        actionRequired: 'reauth-required',
      },
      items: [],
    })
    assert.equal(actionRequiredCreate.operation.state, 'action-required')
    assert.equal(actionRequiredCreate.operation.actionRequired, 'reauth-required')
    assert.deepEqual(actionRequiredCreate.operation.allowedActions, ['cancel'])
    const cancelledCreate = await operations.command(memberId, {
      commandId: nextId(),
      operationId: actionRequiredExecution.grant.operationId,
      expectedOperationRevision: actionRequiredCreate.operation.operationRevision,
      action: 'cancel',
    })
    assert.equal(cancelledCreate.value.state, 'cancelled')

    const cancelledExecution = await openExecution({
      kind: 'existing-list',
      targetListId: 'already-existing-target',
    })
    const cancelledExecutionAttempt = {
      operationId: cancelledExecution.grant.operationId,
      receiptReference: cancelledExecution.receipt.receiptReference,
      attemptId: nextId(),
      phase: 'add-items',
      targetListId: 'already-existing-target',
      sequence: 0,
      final: true,
      outcome: 'completed',
      reconciliationReference: null,
      problem: null,
      items: [{
        itemKey: placeId,
        targetReference: `naver-${placeId}`,
        status: 'applied',
        code: null,
        retryable: null,
        reconciliationReference: null,
      }],
    }
    await prepareAttempt(cancelledExecution, cancelledExecutionAttempt)
    const runningBeforeCancel = await operations.get(
      memberId,
      cancelledExecution.grant.operationId,
    )
    assert.equal(runningBeforeCancel.state, 'running')
    const deferredCancel = await operations.command(memberId, {
      commandId: nextId(),
      operationId: cancelledExecution.grant.operationId,
      expectedOperationRevision: runningBeforeCancel.operationRevision,
      action: 'cancel',
    })
    assert.equal(deferredCancel.value.state, 'running')
    assert.deepEqual(deferredCancel.value.allowedActions, [])
    const reportedAfterCancel = await outbound.recordAttempt({
      receiptToken: cancelledExecution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      attempt: cancelledExecutionAttempt,
    })
    assert.equal(reportedAfterCancel.outcome, 'recorded')
    assert.equal(reportedAfterCancel.operation.state, 'completed')
    assert.equal(reportedAfterCancel.operation.progress.applied, 1)

    const expiringExecution = await openExecution({
      kind: 'existing-list',
      targetListId: 'expiry-reconciliation-target',
    })
    const expiringAttemptId = nextId()
    await prepareAttempt(expiringExecution, {
      operationId: expiringExecution.grant.operationId,
      receiptReference: expiringExecution.receipt.receiptReference,
      attemptId: expiringAttemptId,
      phase: 'add-items',
      targetListId: 'expiry-reconciliation-target',
      sequence: 0,
      final: true,
      outcome: 'completed',
      reconciliationReference: 'expiry-reconciliation-reference',
      problem: null,
      items: [{
        itemKey: placeId,
        targetReference: `naver-${placeId}`,
        status: 'applied',
        code: null,
        retryable: null,
        reconciliationReference: null,
      }],
    })
    const expirySweeper = new transfersModule.PostgresOutboundExecutions(
      database.pool,
      operations,
      {
        grantTtlMilliseconds: 300_000,
        receiptTtlMilliseconds: 300_000,
        maximumBytes: 1_048_576,
        maximumBatches: 10,
        nextId,
        nextToken: () => `expiry-token-${nextId()}`,
        now: () => new Date('2026-09-03T02:10:06.000Z'),
      },
    )
    assert.equal(await expirySweeper.sweepExpiredReceipts(10), 1)
    const expiredPreparedOperation = await operations.get(
      memberId,
      expiringExecution.grant.operationId,
    )
    assert.equal(expiredPreparedOperation.state, 'outcome-unknown')
    assert.equal(expiredPreparedOperation.stage, 'reconciling')
    assert.equal(expiredPreparedOperation.progress.outcomeUnknown, 1)
    assert.deepEqual(expiredPreparedOperation.allowedActions, ['reconcile'])
    assert.deepEqual((await database.pool.query(
      `SELECT intent.state, item.status, item.reconciliation_reference
       FROM transfers.outbound_execution_attempt_intents AS intent
       JOIN transfers.operation_items AS item ON item.operation_id = intent.operation_id
       WHERE intent.attempt_id = $1::uuid`,
      [expiringAttemptId],
    )).rows, [{
      state: 'expired',
      status: 'outcome-unknown',
      reconciliation_reference: 'expiry-reconciliation-reference',
    }])

    const unknownCreateExecution = await openExecution({
      kind: 'new-list',
      name: '생성 결과 재조정 대상',
    })
    const unknownCreateReference = 'provider-create-reconciliation'
    const unknownCreateAttemptId = nextId()
    const unknownCreate = await recordPreparedAttempt(unknownCreateExecution, {
      operationId: unknownCreateExecution.grant.operationId,
      receiptReference: unknownCreateExecution.receipt.receiptReference,
      attemptId: unknownCreateAttemptId,
      phase: 'create-target-list',
      targetListId: null,
      sequence: 0,
      final: true,
      outcome: 'outcome-unknown',
      reconciliationReference: unknownCreateReference,
      problem: null,
      items: [],
    })
    assert.equal(unknownCreate.operation.state, 'outcome-unknown')
    const unknownCreateRevision = unknownCreate.operation.operationRevision
    await assert.rejects(
      outbound.recordReconciliation({
        receiptToken: unknownCreateExecution.receipt.receiptToken,
        sourceOrigin: placeOrigin,
        reconciliation: {
          reconciliationId: nextId(),
          operationId: unknownCreateExecution.grant.operationId,
          receiptReference: unknownCreateExecution.receipt.receiptReference,
          attemptId: unknownCreateAttemptId,
          phase: 'create-target-list',
          targetListId: 'partially-observed-list',
          reconciliationReference: unknownCreateReference,
          outcome: 'resolved-partial',
          items: [],
        },
      }),
      { name: 'ConnectorTransferAuthorizationError' },
    )
    const unchangedUnknownCreate = await operations.get(
      memberId,
      unknownCreateExecution.grant.operationId,
    )
    assert.equal(unchangedUnknownCreate.state, 'outcome-unknown')
    assert.equal(unchangedUnknownCreate.operationRevision, unknownCreateRevision)
    assert.deepEqual((await database.pool.query(
      `SELECT state FROM transfers.outbound_execution_attempt_intents
       WHERE attempt_id = $1::uuid`,
      [unknownCreateAttemptId],
    )).rows, [{ state: 'unknown' }])

    const partialItemsExecution = await openExecution({
      kind: 'existing-list',
      targetListId: 'partial-items-target',
    })
    const partialItemsReference = 'provider-partial-items-reconciliation'
    const partialItemsAttemptId = nextId()
    await recordPreparedAttempt(partialItemsExecution, {
      operationId: partialItemsExecution.grant.operationId,
      receiptReference: partialItemsExecution.receipt.receiptReference,
      attemptId: partialItemsAttemptId,
      phase: 'add-items',
      targetListId: 'partial-items-target',
      sequence: 0,
      final: true,
      outcome: 'outcome-unknown',
      reconciliationReference: partialItemsReference,
      problem: null,
      items: [{
        itemKey: placeId,
        targetReference: `naver-${placeId}`,
        status: 'outcome-unknown',
        code: null,
        retryable: null,
        reconciliationReference: partialItemsReference,
      }],
    })
    const partialItems = await outbound.recordReconciliation({
      receiptToken: partialItemsExecution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      reconciliation: {
        reconciliationId: nextId(),
        operationId: partialItemsExecution.grant.operationId,
        receiptReference: partialItemsExecution.receipt.receiptReference,
        attemptId: partialItemsAttemptId,
        phase: 'add-items',
        targetListId: 'partial-items-target',
        reconciliationReference: partialItemsReference,
        outcome: 'resolved-partial',
        items: [{
          itemKey: placeId,
          status: 'absent',
          targetReference: `naver-${placeId}`,
        }],
      },
    })
    assert.equal(partialItems.outcome, 'recorded')
    assert.equal(partialItems.operation.state, 'partial-failure')
    assert.equal(partialItems.operation.progress.failed, 1)
    assert.deepEqual((await database.pool.query(
      `SELECT state FROM transfers.outbound_execution_attempt_intents
       WHERE attempt_id = $1::uuid`,
      [partialItemsAttemptId],
    )).rows, [{ state: 'reconciled-partial' }])

    const unknownExecution = await openExecution({
      kind: 'existing-list',
      targetListId: 'reconciliation-target',
    })
    const reconciliationReference = 'provider-reconciliation-1'
    const unknownAttemptId = nextId()
    const unknownAttempt = await recordPreparedAttempt(unknownExecution, {
      operationId: unknownExecution.grant.operationId,
      receiptReference: unknownExecution.receipt.receiptReference,
      attemptId: unknownAttemptId,
      phase: 'add-items',
      targetListId: 'reconciliation-target',
      sequence: 0,
      final: true,
      outcome: 'outcome-unknown',
      reconciliationReference,
      problem: null,
      items: [{
        itemKey: placeId,
        targetReference: `naver-${placeId}`,
        status: 'outcome-unknown',
        code: null,
        retryable: null,
        reconciliationReference,
      }],
    })
    assert.equal(unknownAttempt.operation.state, 'outcome-unknown')
    assert.deepEqual(unknownAttempt.operation.allowedActions, ['reconcile'])
    const reconciliation = {
      reconciliationId: nextId(),
      operationId: unknownExecution.grant.operationId,
      receiptReference: unknownExecution.receipt.receiptReference,
      attemptId: unknownAttemptId,
      phase: 'add-items',
      targetListId: 'reconciliation-target',
      reconciliationReference,
      outcome: 'still-unknown',
      items: [{
        itemKey: placeId,
        status: 'unknown',
        targetReference: `naver-${placeId}`,
      }],
    }
    const invalidReconciliations = [
      { reconciliationReference: 'wrong-reference' },
      { phase: 'create-target-list' },
      { targetListId: 'wrong-target-list' },
      { items: [{ ...reconciliation.items[0], targetReference: 'wrong-target-reference' }] },
      { items: [{ ...reconciliation.items[0], itemKey: nextId() }] },
      { outcome: 'resolved-completed', items: [] },
    ]
    for (const invalid of invalidReconciliations) {
      await assert.rejects(
        outbound.recordReconciliation({
          receiptToken: unknownExecution.receipt.receiptToken,
          sourceOrigin: placeOrigin,
          reconciliation: { ...reconciliation, reconciliationId: nextId(), ...invalid },
        }),
        { name: 'ConnectorTransferAuthorizationError' },
      )
    }
    const stillUnknown = await outbound.recordReconciliation({
      receiptToken: unknownExecution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      reconciliation,
    })
    assert.equal(stillUnknown.outcome, 'recorded')
    assert.equal(stillUnknown.operation.state, 'outcome-unknown')
    const resolved = await outbound.recordReconciliation({
      receiptToken: unknownExecution.receipt.receiptToken,
      sourceOrigin: placeOrigin,
      reconciliation: {
        ...reconciliation,
        reconciliationId: nextId(),
        outcome: 'resolved-completed',
        items: [{
          itemKey: placeId,
          status: 'present',
          targetReference: `naver-${placeId}`,
        }],
      },
    })
    assert.equal(resolved.outcome, 'recorded')
    assert.equal(resolved.operation.state, 'completed')
    assert.equal(resolved.operation.progress.outcomeUnknown, 0)
    assert.equal(resolved.operation.progress.applied, 1)
  } finally {
    await fixture.close()
  }
})
