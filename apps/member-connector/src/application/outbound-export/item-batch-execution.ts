import {
  outboundExecutionAttemptV2Schema,
  type OutboundExecutionAttemptV2,
} from '@place/contracts/transfers'

import type { OutboundAttemptSeal, OutboundAttemptSpool } from './ports/attempt-spool.js'
import type { OutboundExecutionControl } from './ports/execution-control.js'
import type {
  SavedPlaceTargetAddItem,
  SavedPlaceTargetAddResult,
} from './ports/saved-place-target.js'
import {
  ApprovedExportCoordinationError,
  isProviderBoundary,
  providerAuthorization,
  providerProblem,
  requireBefore,
  type AuthorizedApprovedExport,
} from './authorization.js'
import { journalPreparedProviderWrite } from './attempt-journal.js'

export async function addItemsCommand(input: Readonly<{
  authorized: AuthorizedApprovedExport
  spool: OutboundAttemptSpool
  control: Pick<OutboundExecutionControl, 'prepareAttempt'>
  signal: AbortSignal
  attemptId: string
  reconciliationReference: string
  now: string
  targetListId: string
  sequence: number
}>): Promise<Readonly<{
  sealedAttempt: OutboundAttemptSeal
  providerCommand: Readonly<{
    operationId: string
    requestFingerprint: string
    planDigest: string
    authorization: ReturnType<typeof providerAuthorization>
    executionContext: Readonly<{ attemptId: string; reconciliationReference: string }>
    preflightReference: string
    targetListId: string
    items: readonly SavedPlaceTargetAddItem[]
  }>
}>> {
  requireBefore(input.authorized.authorization.expiresAt, input.now, 'Provider write authorization expired')
  const { prepared } = input.authorized
  const start = input.sequence * prepared.batchSize
  const committedItems = prepared.grant.manifest.items
    .filter((item) => item.action === 'add')
    .slice(start, start + prepared.batchSize)
  const resolvedItems = committedItems.map((item) => ({
    exportItemId: item.itemKey,
    providerPlaceId: item.targetProviderPlaceId,
    position: item.sourcePosition,
  }))
  if (
    input.sequence < 0 || input.sequence >= prepared.batchCount ||
    resolvedItems.length < 1 || resolvedItems.length > prepared.batchSize
  ) throw new ApprovedExportCoordinationError('provider-result-invalid', 'Add batch differs from the plan')
  const requestFingerprint = `${prepared.plan.requestFingerprint}:${input.sequence}`
  const sealedAttempt: OutboundAttemptSeal = {
    schemaVersion: 'outbound-attempt-seal.v1',
    operationId: prepared.binding.operationId,
    receiptReference: input.authorized.authorization.receiptReference,
    attemptId: input.attemptId,
    phase: 'add-items', targetListId: input.targetListId, sequence: input.sequence,
    final: input.sequence === prepared.batchCount - 1,
    requestFingerprint, planDigest: prepared.binding.planDigest,
    reconciliationReference: input.reconciliationReference,
    items: resolvedItems, sealedAt: input.now,
    writeExpiresAt: input.authorized.authorization.expiresAt,
    reconciliationExpiresAt: input.authorized.authorization.reconciliationExpiresAt,
  }
  await journalPreparedProviderWrite({
    spool: input.spool,
    control: input.control,
    authorization: input.authorized.authorization,
    attempt: sealedAttempt,
    preparedAt: input.now,
    signal: input.signal,
  })
  return {
    sealedAttempt,
    providerCommand: {
      operationId: prepared.binding.operationId,
      requestFingerprint,
      planDigest: prepared.binding.planDigest,
      authorization: providerAuthorization(input.authorized.authorization),
      executionContext: {
        attemptId: input.attemptId,
        reconciliationReference: input.reconciliationReference,
      },
      preflightReference: prepared.grant.manifest.targetObservationRevision,
      targetListId: input.targetListId,
      items: resolvedItems,
    },
  }
}

function addItemResults(
  requested: readonly SavedPlaceTargetAddItem[],
  result: SavedPlaceTargetAddResult,
): OutboundExecutionAttemptV2['items'] {
  if (result.status === 'outcome-unknown') return requested.map((item) => ({
    itemKey: item.exportItemId, targetReference: item.providerPlaceId,
    status: 'outcome-unknown', code: null, retryable: null,
    reconciliationReference: result.reconciliationReference,
  }))
  if (isProviderBoundary(result)) {
    const code = result.status === 'action-required' ? result.reason : result.status
    const retryable = result.status === 'rate-limited' ||
      (result.status === 'provider-unavailable' && result.retryable)
    return requested.map((item) => ({
      itemKey: item.exportItemId, targetReference: item.providerPlaceId,
      status: 'failed', code, retryable, reconciliationReference: null,
    }))
  }
  const byId = new Map(result.items.map((item) => [item.exportItemId, item]))
  if (byId.size !== requested.length) {
    throw new ApprovedExportCoordinationError('provider-result-invalid', 'Provider item set differs')
  }
  return requested.map((requestedItem) => {
    const item = byId.get(requestedItem.exportItemId)
    if (item === undefined) {
      throw new ApprovedExportCoordinationError('provider-result-invalid', 'Provider item set differs')
    }
    if (item.status === 'applied' || item.status === 'already-present') return {
      itemKey: item.exportItemId, targetReference: requestedItem.providerPlaceId,
      status: item.status, code: null, retryable: null, reconciliationReference: null,
    }
    if (item.status === 'failed') return {
      itemKey: item.exportItemId, targetReference: requestedItem.providerPlaceId,
      status: item.status, code: item.code, retryable: item.retryable,
      reconciliationReference: null,
    }
    if (item.status === 'outcome-unknown') return {
      itemKey: item.exportItemId, targetReference: requestedItem.providerPlaceId,
      status: item.status, code: null, retryable: null,
      reconciliationReference: item.reconciliationReference,
    }
    throw new ApprovedExportCoordinationError('provider-result-invalid', 'Provider item result is invalid')
  })
}

export function addItemsAttempt(input: Readonly<{
  authorized: AuthorizedApprovedExport
  sealedAttempt: OutboundAttemptSeal
  targetListId: string
  sequence: number
  requestedItems: readonly SavedPlaceTargetAddItem[]
  result: SavedPlaceTargetAddResult
  now: string
}>): OutboundExecutionAttemptV2 {
  const items = addItemResults(input.requestedItems, input.result)
  const itemUnknownReferences = [...new Set(items
    .filter((item) => item.status === 'outcome-unknown')
    .map((item) => item.reconciliationReference))]
  if (itemUnknownReferences.length > 1) {
    throw new ApprovedExportCoordinationError(
      'provider-result-invalid', 'Provider returned conflicting reconciliation references',
    )
  }
  const reconciliationReference = input.result.status === 'outcome-unknown'
    ? input.result.reconciliationReference
    : itemUnknownReferences[0] ?? null
  const unknown = reconciliationReference !== null
  const expected = input.sealedAttempt
  if (
    expected.operationId !== input.authorized.prepared.binding.operationId ||
    expected.receiptReference !== input.authorized.authorization.receiptReference ||
    expected.phase !== 'add-items' || expected.targetListId !== input.targetListId ||
    expected.sequence !== input.sequence ||
    expected.items.length !== input.requestedItems.length ||
    expected.items.some((item, index) => {
      const requested = input.requestedItems[index]
      return requested === undefined || item.exportItemId !== requested.exportItemId ||
        item.providerPlaceId !== requested.providerPlaceId || item.position !== requested.position
    }) ||
    (unknown && reconciliationReference !== expected.reconciliationReference)
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Provider result differs from the sealed attempt',
  )
  requireBefore(
    unknown ? input.authorized.authorization.reconciliationExpiresAt
      : input.authorized.authorization.expiresAt,
    input.now,
    unknown ? 'Reconciliation reporting window expired' : 'Provider write reporting window expired',
  )
  const failed = items.some((item) => item.status === 'failed')
  const partial = !unknown && (isProviderBoundary(input.result) ||
    input.result.status === 'partial' || failed)
  const problem = partial
    ? isProviderBoundary(input.result)
      ? providerProblem(input.result)
      : {
          code: input.result.status === 'partial' ? 'provider-partial-result' : 'provider-item-failure',
          retryable: items.some((item) => item.status === 'failed' && item.retryable === true),
          actionRequired: null,
        }
    : null
  return outboundExecutionAttemptV2Schema.parse({
    schemaVersion: 'outbound-execution-attempt.v2',
    operationId: input.authorized.prepared.binding.operationId,
    receiptReference: input.authorized.authorization.receiptReference,
    attemptId: expected.attemptId,
    phase: 'add-items', targetListId: input.targetListId, sequence: input.sequence,
    final: input.sequence === input.authorized.prepared.batchCount - 1,
    outcome: unknown ? 'outcome-unknown' : partial ? 'partial' : 'completed',
    reconciliationReference,
    problem,
    items,
  })
}
