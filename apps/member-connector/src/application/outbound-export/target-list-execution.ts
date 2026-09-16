import {
  outboundExecutionAttemptV2Schema,
  type OutboundExecutionAttemptV2,
} from '@place/contracts/transfers'

import type { OutboundAttemptSeal, OutboundAttemptSpool } from './ports/attempt-spool.js'
import type { OutboundExecutionControl } from './ports/execution-control.js'
import type { SavedPlaceTargetCreateResult } from './ports/saved-place-target.js'
import {
  ApprovedExportCoordinationError,
  isProviderBoundary,
  providerAuthorization,
  providerProblem,
  requireBefore,
  type AuthorizedApprovedExport,
} from './authorization.js'
import { journalPreparedProviderWrite } from './attempt-journal.js'

export async function createTargetListCommand(input: Readonly<{
  authorized: AuthorizedApprovedExport
  spool: OutboundAttemptSpool
  control: Pick<OutboundExecutionControl, 'prepareAttempt'>
  signal: AbortSignal
  attemptId: string
  reconciliationReference: string
  now: string
}>): Promise<Readonly<{
  sealedAttempt: OutboundAttemptSeal
  providerCommand: Readonly<{
    commandId: string
    requestFingerprint: string
    authorization: ReturnType<typeof providerAuthorization>
    executionContext: Readonly<{ attemptId: string; reconciliationReference: string }>
    name: string
  }>
}>> {
  const { authorized } = input
  requireBefore(authorized.authorization.expiresAt, input.now, 'Provider write authorization expired')
  const target = authorized.prepared.grant.manifest.target
  if (target.kind !== 'new-list') {
    throw new ApprovedExportCoordinationError('provider-result-invalid', 'Plan does not create a list')
  }
  const sealedAttempt: OutboundAttemptSeal = {
    schemaVersion: 'outbound-attempt-seal.v1',
    operationId: authorized.prepared.binding.operationId,
    receiptReference: authorized.authorization.receiptReference,
    attemptId: input.attemptId,
    phase: 'create-target-list', targetListId: null, sequence: 0, final: true,
    requestFingerprint: authorized.prepared.plan.requestFingerprint,
    planDigest: authorized.prepared.binding.planDigest,
    reconciliationReference: input.reconciliationReference,
    items: [], sealedAt: input.now,
    writeExpiresAt: authorized.authorization.expiresAt,
    reconciliationExpiresAt: authorized.authorization.reconciliationExpiresAt,
  }
  await journalPreparedProviderWrite({
    spool: input.spool,
    control: input.control,
    authorization: authorized.authorization,
    attempt: sealedAttempt,
    preparedAt: input.now,
    signal: input.signal,
  })
  return {
    sealedAttempt,
    providerCommand: {
      commandId: authorized.prepared.binding.operationId,
      requestFingerprint: authorized.prepared.plan.requestFingerprint,
      authorization: providerAuthorization(authorized.authorization),
      executionContext: {
        attemptId: input.attemptId,
        reconciliationReference: input.reconciliationReference,
      },
      name: target.name,
    },
  }
}

export function createTargetListAttempt(input: Readonly<{
  authorized: AuthorizedApprovedExport
  sealedAttempt: OutboundAttemptSeal
  result: SavedPlaceTargetCreateResult
  now: string
}>): OutboundExecutionAttemptV2 {
  const { result } = input
  const successful = result.status === 'created' || result.status === 'replayed'
  const unknown = result.status === 'outcome-unknown'
  const expected = input.sealedAttempt
  if (
    expected.operationId !== input.authorized.prepared.binding.operationId ||
    expected.receiptReference !== input.authorized.authorization.receiptReference ||
    expected.phase !== 'create-target-list' ||
    (unknown && result.reconciliationReference !== expected.reconciliationReference)
  ) throw new ApprovedExportCoordinationError(
    'provider-result-invalid', 'Provider result differs from the sealed attempt',
  )
  requireBefore(
    unknown ? input.authorized.authorization.reconciliationExpiresAt
      : input.authorized.authorization.expiresAt,
    input.now,
    unknown ? 'Reconciliation reporting window expired' : 'Provider write reporting window expired',
  )
  const problem = isProviderBoundary(result) ? providerProblem(result) : null
  return outboundExecutionAttemptV2Schema.parse({
    schemaVersion: 'outbound-execution-attempt.v2',
    operationId: input.authorized.prepared.binding.operationId,
    receiptReference: input.authorized.authorization.receiptReference,
    attemptId: expected.attemptId,
    phase: 'create-target-list',
    targetListId: successful ? result.targetList.targetListId : null,
    sequence: 0,
    final: true,
    outcome: successful ? 'completed' : unknown ? 'outcome-unknown' : 'partial',
    reconciliationReference: unknown ? expected.reconciliationReference : null,
    problem,
    items: [],
  })
}
