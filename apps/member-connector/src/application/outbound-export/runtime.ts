import type {
  OutboundExecutionAttemptV2,
  OutboundExecutionReconciliationV2,
} from '@place/contracts/transfers'

import type { OutboundAttemptSpool } from './ports/attempt-spool.js'
import type { OutboundExecutionControl } from './ports/execution-control.js'
import type {
  OutboundReconciliationAuthorizationVault,
} from './ports/reconciliation-authorization-vault.js'
import type { SavedPlaceTarget, SavedPlaceTargetAddItem } from './ports/saved-place-target.js'
import {
  authorizeApprovedExport,
  prepareApprovedExport,
  type ApprovedExportBinding,
  type ApprovedExportPlan,
  type AuthorizedApprovedExport,
  type PreparedApprovedExport,
} from './authorization.js'
import {
  reportProviderAttempt,
  resumePendingAttempts,
  unobservedProviderWriteAttempt,
  type PendingAttemptResumeResult,
} from './attempt-journal.js'
import { addItemsAttempt, addItemsCommand } from './item-batch-execution.js'
import {
  createdTargetListReconciliation,
  itemReconciliation,
  reconcileCreatedTargetListCommand,
  reconcileItemsCommand,
  reportProviderReconciliation,
} from './reconciliation.js'
import { createTargetListAttempt, createTargetListCommand } from './target-list-execution.js'

export type OutboundExportRuntime = Readonly<{
  providerKey: 'naver' | 'kakao' | 'google'
  prepare(input: Readonly<{
    grant: unknown
    binding: ApprovedExportBinding
    plan: ApprovedExportPlan
    now: string
  }>): Promise<PreparedApprovedExport>
  authorize(input: Readonly<{
    prepared: PreparedApprovedExport
    now: string
    signal: AbortSignal
  }>): Promise<AuthorizedApprovedExport>
  createTargetList(input: Readonly<{
    authorized: AuthorizedApprovedExport
    attemptId: string
    reconciliationReference: string
    now: string
    retainUntil: string
    signal: AbortSignal
  }>): Promise<OutboundExecutionAttemptV2>
  addItems(input: Readonly<{
    authorized: AuthorizedApprovedExport
    attemptId: string
    reconciliationReference: string
    targetListId: string
    sequence: number
    now: string
    retainUntil: string
    signal: AbortSignal
  }>): Promise<OutboundExecutionAttemptV2>
  reconcileTargetList(input: Readonly<{
    authorized: AuthorizedApprovedExport
    attempt: OutboundExecutionAttemptV2
    reconciliationId: string
    now: string
    retainUntil: string
    signal: AbortSignal
  }>): Promise<OutboundExecutionReconciliationV2>
  reconcileItems(input: Readonly<{
    authorized: AuthorizedApprovedExport
    attempt: OutboundExecutionAttemptV2
    reconciliationId: string
    requestedItems: readonly SavedPlaceTargetAddItem[]
    now: string
    retainUntil: string
    signal: AbortSignal
  }>): Promise<OutboundExecutionReconciliationV2>
  resumePending(input: Readonly<{
    now: string
    signal: AbortSignal
    limit?: number
  }>): Promise<readonly PendingAttemptResumeResult[]>
}>

export type OutboundExportRuntimeDependencies = Readonly<{
  target: SavedPlaceTarget
  control: OutboundExecutionControl
  spool: OutboundAttemptSpool
  vault: OutboundReconciliationAuthorizationVault
}>

function assertExportBinding(
  providerKey: OutboundExportRuntime['providerKey'],
  dependencies: OutboundExportRuntimeDependencies,
): void {
  const { target, control, spool, vault } = dependencies
  const capabilities = target.capabilities
  if (
    target.providerKey !== providerKey || capabilities.providerKey !== providerKey ||
    capabilities.deliveryState !== 'available' || capabilities.transport === null ||
    capabilities.evidence.kind !== 'verified-adapter' ||
    capabilities.maximumAddItems === null || capabilities.maximumAddItems < 1 ||
    capabilities.capabilities['preflight-add'] !== 'available' ||
    capabilities.capabilities['add-places'] !== 'available' ||
    capabilities.capabilities['reconcile-add'] !== 'available' ||
    typeof target.preflight !== 'function' || typeof target.add !== 'function' ||
    typeof target.reconcile !== 'function' ||
    typeof control.consume !== 'function' || typeof control.prepareAttempt !== 'function' ||
    typeof control.recordAttempt !== 'function' ||
    typeof control.recordReconciliation !== 'function' ||
    typeof spool.seal !== 'function' || typeof spool.listPending !== 'function' ||
    typeof spool.load !== 'function' || typeof spool.acknowledgePrepared !== 'function' ||
    typeof spool.acknowledgeReported !== 'function' || typeof spool.complete !== 'function' ||
    typeof spool.remove !== 'function' || typeof vault.seal !== 'function' ||
    typeof vault.load !== 'function'
  ) throw new Error(`Connector export runtime is not available for ${providerKey}`)
}

/**
 * Deep outbound-export interface. Provider writes, durable journal transitions and Backend
 * acknowledgements are coordinated here so callers cannot reorder them.
 */
export function composeOutboundExportRuntime(
  providerKey: OutboundExportRuntime['providerKey'],
  dependencies: OutboundExportRuntimeDependencies,
): OutboundExportRuntime {
  const { target, control, spool, vault } = dependencies
  assertExportBinding(providerKey, dependencies)

  const reportAttempt = async (input: Readonly<{
    authorized: AuthorizedApprovedExport
    attempt: OutboundExecutionAttemptV2
    now: string
    retainUntil: string
    signal: AbortSignal
  }>) => reportProviderAttempt({ ...input, spool, control })

  return Object.freeze({
    providerKey,
    prepare: (input) => prepareApprovedExport({ ...input, capabilities: target.capabilities }),
    authorize: async ({ prepared, now, signal }) => {
      const candidate = await control.consume({
        token: prepared.grant.token,
        request: prepared.consumeRequest,
        signal,
      })
      return authorizeApprovedExport(prepared, candidate, now, vault)
    },
    createTargetList: async (input) => {
      if (
        target.capabilities.capabilities['create-target-list'] !== 'available' ||
        target.capabilities.capabilities['reconcile-create-target-list'] !== 'available'
      ) throw new Error(`Connector target-list creation is not available for ${providerKey}`)
      const command = await createTargetListCommand({ ...input, spool, control })
      let attempt: OutboundExecutionAttemptV2
      try {
        const result = await target.createTargetList({ ...command.providerCommand, signal: input.signal })
        attempt = createTargetListAttempt({
          authorized: input.authorized,
          sealedAttempt: command.sealedAttempt,
          result,
          now: input.now,
        })
      } catch {
        attempt = unobservedProviderWriteAttempt({
          authorized: input.authorized,
          sealedAttempt: command.sealedAttempt,
          now: input.now,
        })
      }
      await reportAttempt({ ...input, attempt })
      return attempt
    },
    addItems: async (input) => {
      const command = await addItemsCommand({ ...input, spool, control })
      let attempt: OutboundExecutionAttemptV2
      try {
        const result = await target.add({ ...command.providerCommand, signal: input.signal })
        attempt = addItemsAttempt({
          authorized: input.authorized,
          sealedAttempt: command.sealedAttempt,
          targetListId: input.targetListId,
          sequence: input.sequence,
          requestedItems: command.providerCommand.items,
          result,
          now: input.now,
        })
      } catch {
        attempt = unobservedProviderWriteAttempt({
          authorized: input.authorized,
          sealedAttempt: command.sealedAttempt,
          now: input.now,
        })
      }
      await reportAttempt({ ...input, attempt })
      return attempt
    },
    reconcileTargetList: async (input) => {
      if (target.capabilities.capabilities['reconcile-create-target-list'] !== 'available') {
        throw new Error(`Connector target-list reconciliation is not available for ${providerKey}`)
      }
      const command = reconcileCreatedTargetListCommand(input)
      let result
      try {
        result = await target.reconcileCreateTargetList({ ...command, signal: input.signal })
      } catch {
        result = {
          status: 'outcome-unknown' as const,
          reconciliationReference: command.reconciliationReference,
        }
      }
      const reconciliation = createdTargetListReconciliation({
        authorized: input.authorized,
        attempt: input.attempt,
        reconciliationId: input.reconciliationId,
        result,
      })
      await reportProviderReconciliation({ ...input, spool, control, reconciliation })
      return reconciliation
    },
    reconcileItems: async (input) => {
      const reconciliationReference = input.attempt.reconciliationReference
      if (reconciliationReference === null) {
        throw new Error('Connector item reconciliation reference is unavailable')
      }
      const entry = await spool.load(input.attempt.attemptId)
      if (entry === null || entry.state !== 'reported' || entry.attempt.phase !== 'add-items') {
        throw new Error('Connector item reconciliation attempt is unavailable')
      }
      const command = reconcileItemsCommand({
        authorized: input.authorized,
        attempt: input.attempt,
        requestFingerprint: entry.attempt.requestFingerprint,
        items: input.requestedItems,
        reconciliationReference,
        now: input.now,
      })
      let result
      try {
        result = await target.reconcile({ ...command, signal: input.signal })
      } catch {
        result = { status: 'outcome-unknown' as const, reconciliationReference }
      }
      const reconciliation = itemReconciliation({
        authorized: input.authorized,
        attempt: input.attempt,
        reconciliationId: input.reconciliationId,
        reconciliationReference,
        requestedItems: input.requestedItems,
        result,
      })
      await reportProviderReconciliation({ ...input, spool, control, reconciliation })
      return reconciliation
    },
    resumePending: (input) => resumePendingAttempts({ ...input, spool, vault, control }),
  })
}
