import {
  outboundExecutionReconciliationReceiptV2Schema,
  outboundExecutionReconciliationV2Schema,
  type OutboundExecutionAttemptV2,
  type OutboundExecutionReconciliationV2,
} from '@place/contracts/transfers'

import type { OutboundAttemptSpool } from './ports/attempt-spool.js'
import type { OutboundExecutionControl } from './ports/execution-control.js'
import type {
  SavedPlaceTargetAddItem,
  SavedPlaceTargetCreateReconciliationResult,
  SavedPlaceTargetReconciliationResult,
} from './ports/saved-place-target.js'
import {
  ApprovedExportCoordinationError,
  providerAuthorization,
  requireBefore,
  type AuthorizedApprovedExport,
} from './authorization.js'
import {
  requireRecordedOperationBinding,
  requireRetentionWindow,
} from './attempt-journal.js'

export function reconcileCreatedTargetListCommand(input: Readonly<{
  authorized: AuthorizedApprovedExport
  attempt: OutboundExecutionAttemptV2
  now: string
}>): Readonly<{
  operationId: string
  requestFingerprint: string
  authorization: ReturnType<typeof providerAuthorization>
  reconciliationReference: string
}> {
  requireBefore(
    input.authorized.authorization.reconciliationExpiresAt,
    input.now,
    'Reconciliation authorization expired',
  )
  if (
    input.attempt.phase !== 'create-target-list' ||
    input.attempt.outcome !== 'outcome-unknown' ||
    input.attempt.reconciliationReference === null
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Attempt cannot reconcile target-list creation',
  )
  return {
    operationId: input.authorized.prepared.binding.operationId,
    requestFingerprint: input.authorized.prepared.plan.requestFingerprint,
    authorization: providerAuthorization(input.authorized.authorization),
    reconciliationReference: input.attempt.reconciliationReference,
  }
}

export function createdTargetListReconciliation(input: Readonly<{
  authorized: AuthorizedApprovedExport
  attempt: OutboundExecutionAttemptV2
  /** A fresh UUID for this observation; reuse only when replaying the same report transport. */
  reconciliationId: string
  result: SavedPlaceTargetCreateReconciliationResult
}>): OutboundExecutionReconciliationV2 {
  if (
    input.attempt.phase !== 'create-target-list' ||
    input.attempt.outcome !== 'outcome-unknown' ||
    input.attempt.reconciliationReference === null
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Attempt cannot record target-list reconciliation',
  )
  if (
    input.result.status === 'outcome-unknown' &&
    input.result.reconciliationReference !== input.attempt.reconciliationReference
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Provider reconciliation reference differs from the attempt',
  )
  const resolved = input.result.status === 'reconciled'
  const targetListId = resolved ? input.result.targetList.targetListId : null
  return outboundExecutionReconciliationV2Schema.parse({
    schemaVersion: 'outbound-execution-reconciliation.v2',
    reconciliationId: input.reconciliationId,
    operationId: input.authorized.prepared.binding.operationId,
    receiptReference: input.authorized.authorization.receiptReference,
    attemptId: input.attempt.attemptId,
    phase: 'create-target-list', targetListId,
    reconciliationReference: input.attempt.reconciliationReference,
    outcome: resolved ? 'resolved-completed' : 'still-unknown',
    items: [],
  })
}

export function reconcileItemsCommand(input: Readonly<{
  authorized: AuthorizedApprovedExport
  attempt: OutboundExecutionAttemptV2
  requestFingerprint: string
  items: readonly SavedPlaceTargetAddItem[]
  reconciliationReference: string
  now: string
}>): Readonly<{
  operationId: string
  requestFingerprint: string
  targetListId: string
  reconciliationReference: string
  items: readonly SavedPlaceTargetAddItem[]
}> {
  requireBefore(
    input.authorized.authorization.reconciliationExpiresAt,
    input.now,
    'Reconciliation authorization expired',
  )
  if (
    input.attempt.phase !== 'add-items' || input.attempt.targetListId === null ||
    input.attempt.outcome !== 'outcome-unknown' ||
    input.attempt.reconciliationReference !== input.reconciliationReference ||
    input.attempt.items.length !== input.items.length ||
    input.attempt.items.some((item, index) => {
      const requested = input.items[index]
      return requested === undefined || item.itemKey !== requested.exportItemId ||
        item.targetReference !== requested.providerPlaceId
    })
  ) {
    throw new ApprovedExportCoordinationError('provider-result-invalid', 'Attempt cannot reconcile items')
  }
  return {
    operationId: input.authorized.prepared.binding.operationId,
    requestFingerprint: input.requestFingerprint,
    targetListId: input.attempt.targetListId,
    reconciliationReference: input.reconciliationReference,
    items: input.items,
  }
}

export function itemReconciliation(input: Readonly<{
  authorized: AuthorizedApprovedExport
  attempt: OutboundExecutionAttemptV2
  /** A fresh UUID for this observation; reuse only when replaying the same report transport. */
  reconciliationId: string
  reconciliationReference: string
  requestedItems: readonly SavedPlaceTargetAddItem[]
  result: SavedPlaceTargetReconciliationResult
}>): OutboundExecutionReconciliationV2 {
  if (
    input.attempt.phase !== 'add-items' || input.attempt.outcome !== 'outcome-unknown' ||
    input.attempt.reconciliationReference !== input.reconciliationReference ||
    input.attempt.items.length !== input.requestedItems.length ||
    input.attempt.items.some((item, index) => {
      const requested = input.requestedItems[index]
      return requested === undefined || item.itemKey !== requested.exportItemId ||
        item.targetReference !== requested.providerPlaceId
    }) ||
    (input.result.status === 'outcome-unknown' &&
      input.result.reconciliationReference !== input.reconciliationReference)
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Reconciliation differs from the sealed Provider attempt',
  )
  let items: OutboundExecutionReconciliationV2['items']
  if (input.result.status === 'outcome-unknown') {
    items = input.requestedItems.map((item) => ({
      itemKey: item.exportItemId, status: 'unknown', targetReference: item.providerPlaceId,
    }))
  } else if (input.result.status === 'reconciled') {
    const byId = new Map(input.result.items.map((item) => [item.exportItemId, item]))
    if (byId.size !== input.requestedItems.length) {
      throw new ApprovedExportCoordinationError('provider-result-invalid', 'Reconciliation item set differs')
    }
    items = input.requestedItems.map((item) => {
      const observed = byId.get(item.exportItemId)
      if (observed === undefined) {
        throw new ApprovedExportCoordinationError('provider-result-invalid', 'Reconciliation item set differs')
      }
      return {
        itemKey: item.exportItemId, status: observed.status,
        targetReference: item.providerPlaceId,
      }
    })
  } else {
    items = input.requestedItems.map((item) => ({
      itemKey: item.exportItemId, status: 'unknown', targetReference: item.providerPlaceId,
    }))
  }
  return outboundExecutionReconciliationV2Schema.parse({
    schemaVersion: 'outbound-execution-reconciliation.v2',
    reconciliationId: input.reconciliationId,
    operationId: input.authorized.prepared.binding.operationId,
    receiptReference: input.authorized.authorization.receiptReference,
    attemptId: input.attempt.attemptId,
    phase: 'add-items', targetListId: input.attempt.targetListId,
    reconciliationReference: input.reconciliationReference,
    outcome: items.some((item) => item.status === 'unknown') ? 'still-unknown'
      : items.some((item) => item.status === 'absent') ? 'resolved-partial'
        : 'resolved-completed',
    items,
  })
}

/** Completes local retained history only after the Backend records a resolved reconciliation. */
export async function reportProviderReconciliation(input: Readonly<{
  authorized: AuthorizedApprovedExport
  spool: OutboundAttemptSpool
  control: Pick<OutboundExecutionControl, 'recordReconciliation'>
  reconciliation: OutboundExecutionReconciliationV2
  now: string
  retainUntil: string
  signal: AbortSignal
}>): Promise<void> {
  const entry = await input.spool.load(input.reconciliation.attemptId)
  if (entry === null || entry.state !== 'reported') {
    throw new ApprovedExportCoordinationError(
      'reconciliation-not-recorded', 'Only a reported unknown attempt can be reconciled',
    )
  }
  const sealed = entry.attempt
  const reconciliation = input.reconciliation
  const targetMatches = sealed.phase === 'add-items'
    ? reconciliation.targetListId === sealed.targetListId
    : sealed.targetListId === null && (
        reconciliation.outcome === 'resolved-completed'
          ? reconciliation.targetListId !== null
          : reconciliation.outcome === 'still-unknown' && reconciliation.targetListId === null
      )
  if (
    reconciliation.operationId !== sealed.operationId ||
    reconciliation.receiptReference !== sealed.receiptReference ||
    reconciliation.attemptId !== sealed.attemptId ||
    reconciliation.phase !== sealed.phase ||
    !targetMatches ||
    reconciliation.reconciliationReference !== sealed.reconciliationReference ||
    reconciliation.items.length !== sealed.items.length ||
    reconciliation.items.some((item, index) => {
      const requested = sealed.items[index]
      return requested === undefined || item.itemKey !== requested.exportItemId ||
        item.targetReference !== requested.providerPlaceId
    })
  ) throw new ApprovedExportCoordinationError(
    'reconciliation-not-recorded', 'Reconciliation differs from its durable Provider attempt',
  )
  requireBefore(
    input.authorized.authorization.reconciliationExpiresAt,
    input.now,
    'Reconciliation authorization expired',
  )
  if (reconciliation.outcome !== 'still-unknown') {
    requireRetentionWindow(
      input.retainUntil, sealed.reconciliationExpiresAt, input.now,
    )
  }
  const candidate = await input.control.recordReconciliation({
    receiptToken: input.authorized.authorization.receiptToken,
    reconciliation,
    signal: input.signal,
  })
  const receipt = outboundExecutionReconciliationReceiptV2Schema.safeParse(candidate)
  if (!receipt.success) {
    throw new ApprovedExportCoordinationError(
      'reconciliation-not-recorded', 'Backend did not acknowledge the reconciliation',
    )
  }
  requireRecordedOperationBinding(
    receipt.data.operation, input.authorized.prepared.binding, 'reconciliation-not-recorded',
  )
  if (reconciliation.outcome === 'still-unknown') return

  const completed = await input.spool.complete({
    attemptId: sealed.attemptId,
    completedAt: input.now,
    retainUntil: input.retainUntil,
  })
  if (completed !== 'completed' && completed !== 'replayed') {
    throw new ApprovedExportCoordinationError(
      'reconciliation-not-recorded', 'Resolved reconciliation was not durably retained',
    )
  }
}
