import {
  outboundExecutionAttemptIntentReceiptV2Schema,
  outboundExecutionAttemptIntentV2Schema,
  outboundExecutionAttemptReceiptV2Schema,
  outboundExecutionAttemptV2Schema,
  outboundExecutionAuthorizationReceiptV2Schema,
  type OutboundExecutionAttemptV2,
  type OutboundExecutionAuthorizationReceiptV2,
} from '@place/contracts/transfers'

import type { OutboundAttemptSeal, OutboundAttemptSpool } from './ports/attempt-spool.js'
import type { OutboundExecutionControl } from './ports/execution-control.js'
import type {
  OutboundReconciliationAuthorizationVault,
} from './ports/reconciliation-authorization-vault.js'
import {
  ApprovedExportCoordinationError,
  requireBefore,
  type AuthorizedApprovedExport,
} from './authorization.js'

function requireAttemptIdentity(attemptId: string, reconciliationReference: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId) ||
    reconciliationReference.length < 1 || reconciliationReference.length > 512
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Provider attempt correlation is invalid',
  )
}

async function sealProviderWrite(
  spool: OutboundAttemptSpool,
  attempt: OutboundAttemptSeal,
): Promise<void> {
  requireAttemptIdentity(attempt.attemptId, attempt.reconciliationReference)
  const sealed = await spool.seal(attempt)
  if (sealed !== 'sealed') {
    throw new ApprovedExportCoordinationError(
      'attempt-not-sealed',
      sealed === 'replayed'
        ? 'Provider attempt was already sealed; reconcile it instead of replaying the write'
        : 'Provider attempt conflicts with the durable write-ahead record',
    )
  }
}

async function prepareProviderWrite(
  control: Pick<OutboundExecutionControl, 'prepareAttempt'>,
  authorization: OutboundExecutionAuthorizationReceiptV2,
  attempt: OutboundAttemptSeal,
  signal: AbortSignal,
): Promise<void> {
  const intent = outboundExecutionAttemptIntentV2Schema.parse({
    schemaVersion: 'outbound-execution-attempt-intent.v2',
    operationId: attempt.operationId,
    receiptReference: attempt.receiptReference,
    attemptId: attempt.attemptId,
    phase: attempt.phase,
    targetListId: attempt.targetListId,
    sequence: attempt.sequence,
    final: attempt.final,
    reconciliationReference: attempt.reconciliationReference,
    items: attempt.items.map((item) => ({
      itemKey: item.exportItemId,
      targetReference: item.providerPlaceId,
    })),
  })
  const candidate = await control.prepareAttempt({
    receiptToken: authorization.receiptToken,
    intent,
    signal,
  })
  const receipt = outboundExecutionAttemptIntentReceiptV2Schema.safeParse(candidate)
  if (
    !receipt.success || receipt.data.operationId !== intent.operationId ||
    receipt.data.attemptId !== intent.attemptId
  ) throw new ApprovedExportCoordinationError(
    'attempt-not-prepared', 'Backend did not acknowledge the exact sealed Provider attempt',
  )
}

async function acknowledgePreparedWrite(
  spool: OutboundAttemptSpool,
  attemptId: string,
  preparedAt: string,
  allowReplay = false,
): Promise<void> {
  const acknowledged = await spool.acknowledgePrepared({ attemptId, preparedAt })
  if (acknowledged !== 'acknowledged' && !(allowReplay && acknowledged === 'replayed')) {
    throw new ApprovedExportCoordinationError(
      'attempt-not-prepared', 'Prepared Provider attempt was not durably acknowledged',
    )
  }
}

/**
 * Enforces the only write path: local seal, exact Backend intent, local prepared acknowledgement.
 */
export async function journalPreparedProviderWrite(input: Readonly<{
  spool: OutboundAttemptSpool
  control: Pick<OutboundExecutionControl, 'prepareAttempt'>
  authorization: OutboundExecutionAuthorizationReceiptV2
  attempt: OutboundAttemptSeal
  preparedAt: string
  signal: AbortSignal
}>): Promise<void> {
  await sealProviderWrite(input.spool, input.attempt)
  await prepareProviderWrite(input.control, input.authorization, input.attempt, input.signal)
  await acknowledgePreparedWrite(input.spool, input.attempt.attemptId, input.preparedAt)
}

export function requireRecordedOperationBinding(
  operation: Readonly<{
    operationId: string
    kind: string
    providerKey: string | null
    connectionId: string | null
    resource: Readonly<{ kind: string; transferId?: string }>
  }>,
  binding: Readonly<{
    operationId: string
    transferId: string
    providerKey: string
    connectionId: string
  }>,
  code: 'attempt-not-reported' | 'reconciliation-not-recorded',
): void {
  if (
    operation.operationId !== binding.operationId ||
    operation.kind !== 'outbound-transfer' ||
    operation.providerKey !== binding.providerKey ||
    operation.connectionId !== binding.connectionId ||
    operation.resource.kind !== 'outbound-transfer' ||
    operation.resource.transferId !== binding.transferId
  ) throw new ApprovedExportCoordinationError(
    code, 'Backend acknowledgement differs from the approved outbound operation',
  )
}

function requireAttemptMatchesSeal(
  attempt: OutboundExecutionAttemptV2,
  sealed: OutboundAttemptSeal,
): void {
  const targetMatches = sealed.phase === 'add-items'
    ? attempt.targetListId === sealed.targetListId
    : sealed.targetListId === null && (
        attempt.outcome === 'completed'
          ? attempt.targetListId !== null
          : attempt.targetListId === null
      )
  if (
    attempt.operationId !== sealed.operationId ||
    attempt.receiptReference !== sealed.receiptReference ||
    attempt.attemptId !== sealed.attemptId ||
    attempt.phase !== sealed.phase ||
    !targetMatches ||
    attempt.sequence !== sealed.sequence ||
    attempt.final !== sealed.final ||
    (attempt.outcome === 'outcome-unknown' &&
      attempt.reconciliationReference !== sealed.reconciliationReference) ||
    attempt.items.length !== sealed.items.length ||
    attempt.items.some((item, index) => {
      const requested = sealed.items[index]
      return requested === undefined || item.itemKey !== requested.exportItemId ||
        item.targetReference !== requested.providerPlaceId
    })
  ) throw new ApprovedExportCoordinationError(
    'attempt-not-reported', 'Provider attempt differs from its durable write-ahead record',
  )
}

export function requireRetentionWindow(
  retainUntil: string,
  reconciliationExpiresAt: string,
  now: string,
): void {
  const retention = Date.parse(retainUntil)
  if (
    !Number.isFinite(retention) || retention <= Date.parse(now) ||
    retention < Date.parse(reconciliationExpiresAt)
  ) throw new ApprovedExportCoordinationError(
    'attempt-not-reported', 'Attempt retention must cover the reconciliation window',
  )
}

/** Records the exact Provider observation and advances the durable journal after Backend ack. */
export async function reportProviderAttempt(input: Readonly<{
  authorized: AuthorizedApprovedExport
  spool: OutboundAttemptSpool
  control: Pick<OutboundExecutionControl, 'recordAttempt'>
  attempt: OutboundExecutionAttemptV2
  now: string
  retainUntil: string
  signal: AbortSignal
}>): Promise<void> {
  const entry = await input.spool.load(input.attempt.attemptId)
  if (entry === null || entry.state === 'sealed' || entry.state === 'completed') {
    throw new ApprovedExportCoordinationError(
      'attempt-not-reported', 'Only a prepared Provider attempt can be reported',
    )
  }
  requireAttemptMatchesSeal(input.attempt, entry.attempt)
  requireBefore(
    input.attempt.outcome === 'outcome-unknown'
      ? input.authorized.authorization.reconciliationExpiresAt
      : input.authorized.authorization.expiresAt,
    input.now,
    input.attempt.outcome === 'outcome-unknown'
      ? 'Reconciliation reporting window expired'
      : 'Provider write reporting window expired',
  )
  if (input.attempt.outcome !== 'outcome-unknown') {
    requireRetentionWindow(
      input.retainUntil, entry.attempt.reconciliationExpiresAt, input.now,
    )
  }
  const candidate = await input.control.recordAttempt({
    receiptToken: input.authorized.authorization.receiptToken,
    attempt: input.attempt,
    signal: input.signal,
  })
  const receipt = outboundExecutionAttemptReceiptV2Schema.safeParse(candidate)
  if (!receipt.success) {
    throw new ApprovedExportCoordinationError(
      'attempt-not-reported', 'Backend did not acknowledge the Provider attempt',
    )
  }
  requireRecordedOperationBinding(
    receipt.data.operation, input.authorized.prepared.binding, 'attempt-not-reported',
  )
  const reported = await input.spool.acknowledgeReported({
    attemptId: input.attempt.attemptId,
    reportedAt: input.now,
  })
  if (reported !== 'acknowledged' && reported !== 'replayed') {
    throw new ApprovedExportCoordinationError(
      'attempt-not-reported', 'Attempt report was not durably acknowledged',
    )
  }
  if (input.attempt.outcome === 'outcome-unknown') return

  const completed = await input.spool.complete({
    attemptId: input.attempt.attemptId,
    completedAt: input.now,
    retainUntil: input.retainUntil,
  })
  if (completed !== 'completed' && completed !== 'replayed') {
    throw new ApprovedExportCoordinationError(
      'attempt-not-reported', 'Terminal attempt was not durably retained',
    )
  }
}

function outcomeUnknownAttemptFromSeal(sealed: OutboundAttemptSeal): OutboundExecutionAttemptV2 {
  return outboundExecutionAttemptV2Schema.parse({
    schemaVersion: 'outbound-execution-attempt.v2',
    operationId: sealed.operationId,
    receiptReference: sealed.receiptReference,
    attemptId: sealed.attemptId,
    phase: sealed.phase,
    targetListId: sealed.targetListId,
    sequence: sealed.sequence,
    final: sealed.final,
    outcome: 'outcome-unknown',
    reconciliationReference: sealed.reconciliationReference,
    problem: null,
    items: sealed.items.map((item) => ({
      itemKey: item.exportItemId,
      targetReference: item.providerPlaceId,
      status: 'outcome-unknown',
      code: null,
      retryable: null,
      reconciliationReference: sealed.reconciliationReference,
    })),
  })
}

/** Converts a response-loss crash into an unknown observation, never a Provider replay. */
export function unobservedProviderWriteAttempt(input: Readonly<{
  authorized: AuthorizedApprovedExport
  sealedAttempt: OutboundAttemptSeal
  now: string
}>): OutboundExecutionAttemptV2 {
  const { sealedAttempt: sealed, authorized } = input
  if (
    sealed.operationId !== authorized.prepared.binding.operationId ||
    sealed.receiptReference !== authorized.authorization.receiptReference ||
    (sealed.phase === 'create-target-list' &&
      (sealed.targetListId !== null || sealed.items.length !== 0)) ||
    (sealed.phase === 'add-items' && sealed.targetListId === null)
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Sealed attempt differs from the approved operation',
  )
  requireBefore(
    authorized.authorization.reconciliationExpiresAt,
    input.now,
    'Reconciliation reporting window expired',
  )
  return outcomeUnknownAttemptFromSeal(sealed)
}

export type PendingAttemptResumeResult = Readonly<{
  attemptId: string
  state: 'reported' | 'ready-to-reconcile' | 'backend-unavailable'
  attempt: OutboundExecutionAttemptV2
  code: string | null
}>

/** Bounded restart handshake that never replays a Provider mutation. */
export async function resumePendingAttempts(input: Readonly<{
  spool: OutboundAttemptSpool
  vault: OutboundReconciliationAuthorizationVault
  control: Pick<OutboundExecutionControl, 'prepareAttempt' | 'recordAttempt'>
  now: string
  signal: AbortSignal
  limit?: number
}>): Promise<readonly PendingAttemptResumeResult[]> {
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApprovedExportCoordinationError(
      'provider-result-invalid', 'Pending attempt recovery limit is invalid',
    )
  }
  const entries = await input.spool.listPending({ limit })
  if (entries.length > limit) {
    throw new ApprovedExportCoordinationError(
      'provider-result-invalid', 'Attempt spool exceeded the bounded recovery page',
    )
  }
  const results: PendingAttemptResumeResult[] = []
  const seenAttemptIds = new Set<string>()
  for (const entry of entries) {
    const sealed = entry.attempt
    if (entry.state === 'completed' || seenAttemptIds.has(sealed.attemptId)) {
      throw new ApprovedExportCoordinationError(
        'provider-result-invalid', 'Attempt spool returned an invalid recovery page',
      )
    }
    seenAttemptIds.add(sealed.attemptId)
    const candidate = await input.vault.load(sealed.receiptReference)
    const authorization = outboundExecutionAuthorizationReceiptV2Schema.safeParse(candidate)
    if (
      !authorization.success ||
      authorization.data.operationId !== sealed.operationId ||
      authorization.data.receiptReference !== sealed.receiptReference ||
      authorization.data.planDigest !== sealed.planDigest ||
      authorization.data.expiresAt !== sealed.writeExpiresAt ||
      authorization.data.reconciliationExpiresAt !== sealed.reconciliationExpiresAt
    ) throw new ApprovedExportCoordinationError(
      'binding-mismatch', 'Pending attempt differs from secure reconciliation authorization',
    )
    requireBefore(
      authorization.data.reconciliationExpiresAt,
      input.now,
      'Reconciliation authorization expired',
    )
    const attempt = outcomeUnknownAttemptFromSeal(sealed)
    if (entry.state === 'reported') {
      results.push({ attemptId: sealed.attemptId, state: 'ready-to-reconcile', attempt, code: null })
      continue
    }
    if (entry.state === 'sealed') {
      try {
        await prepareProviderWrite(input.control, authorization.data, sealed, input.signal)
      } catch (error) {
        if (error instanceof ApprovedExportCoordinationError && error.code === 'attempt-not-prepared') {
          results.push({
            attemptId: sealed.attemptId, state: 'backend-unavailable', attempt,
            code: error.code,
          })
          continue
        }
        throw error
      }
      await acknowledgePreparedWrite(input.spool, sealed.attemptId, input.now, true)
    }
    const receiptCandidate = await input.control.recordAttempt({
      receiptToken: authorization.data.receiptToken,
      attempt,
      signal: input.signal,
    })
    const receipt = outboundExecutionAttemptReceiptV2Schema.safeParse(receiptCandidate)
    if (!receipt.success) {
      const code = 'code' in receiptCandidate ? receiptCandidate.code : 'attempt-report-unavailable'
      results.push({ attemptId: sealed.attemptId, state: 'backend-unavailable', attempt, code })
      continue
    }
    requireRecordedOperationBinding(
      receipt.data.operation, authorization.data, 'attempt-not-reported',
    )
    const acknowledged = await input.spool.acknowledgeReported({
      attemptId: sealed.attemptId,
      reportedAt: input.now,
    })
    if (acknowledged !== 'acknowledged' && acknowledged !== 'replayed') {
      throw new ApprovedExportCoordinationError(
        'attempt-not-prepared', 'Attempt report was not durably acknowledged',
      )
    }
    results.push({ attemptId: sealed.attemptId, state: 'reported', attempt, code: null })
  }
  return results
}
