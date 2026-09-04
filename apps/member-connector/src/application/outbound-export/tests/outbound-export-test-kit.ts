import { outboundExecutionPlanDigestInputV2 } from '@place/contracts/transfers'
import { vi } from 'vitest'

import type { OutboundAttemptSeal, OutboundAttemptSpool, OutboundAttemptSpoolEntry } from '../ports/attempt-spool.js'
import type { OutboundExecutionControl } from '../ports/execution-control.js'
import type { OutboundReconciliationAuthorizationVault } from '../ports/reconciliation-authorization-vault.js'
import type {
  SavedPlaceTarget,
  SavedPlaceTargetCapabilities,
  SavedPlaceTargetCapability,
} from '../ports/saved-place-target.js'
import { composeOutboundExportRuntime } from '../index.js'
import type {
  AuthorizedApprovedExport,
  OutboundExportRuntime,
  OutboundExportRuntimeDependencies,
  PreparedApprovedExport,
} from '../index.js'

export const operationId = '11111111-1111-4111-8111-111111111111'
export const transferId = '22222222-2222-4222-8222-222222222222'
export const connectionId = '33333333-3333-4333-8333-333333333333'
export const installationId = '44444444-4444-4444-8444-444444444444'
export const grantId = '55555555-5555-4555-8555-555555555555'
export const receiptReference = '66666666-6666-4666-8666-666666666666'
export const attemptId = '77777777-7777-4777-8777-777777777777'
export const reconciliationId = '12121212-1212-4121-8121-121212121212'
export const itemKey = '88888888-8888-4888-8888-888888888888'
export const secondItemKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const accountFingerprint = 'a'.repeat(64)
export const requestFingerprint = 'c'.repeat(64)
export const now = '2026-09-03T00:02:00.000Z'
export const retainUntil = '2026-09-05T00:00:00.000Z'
export const limits = { maximumItems: 100, maximumBytes: 100_000, maximumBatches: 10 }

const capabilityKeys = [
  'list-target-lists', 'create-target-list', 'resolve-places', 'preflight-add', 'add-places',
  'reconcile-create-target-list', 'reconcile-add',
] as const satisfies readonly SavedPlaceTargetCapability[]

export const availableCapabilities: SavedPlaceTargetCapabilities = {
  providerKey: 'naver', deliveryState: 'available', transport: 'browser-session',
  capabilities: Object.fromEntries(capabilityKeys.map((key) => [key, 'available'])) as
    Record<SavedPlaceTargetCapability, 'available'>,
  maximumAddItems: 100, preservesOrder: 'supported', acceptsPrivateNotes: 'unsupported',
  evidence: { kind: 'verified-adapter', summary: 'Deterministic test adapter.' },
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}

export async function approvedGrant(target: Readonly<
  { kind: 'existing-list'; targetListId: string } | { kind: 'new-list'; name: string }
> = { kind: 'existing-list', targetListId: 'target-list-a' }) {
  const commitment = {
    operationId, transferId, connectionId, providerKey: 'naver' as const,
    accountFingerprint,
    collectionId: '99999999-9999-4999-8999-999999999999',
    collectionRevision: 'collection-r1', targetObservationRevision: 'target-r1',
    target,
    items: [{
      itemKey, placeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      targetProviderPlaceId: 'provider-place-a', action: 'add' as const, sourcePosition: 1,
    }, {
      itemKey: secondItemKey, placeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      targetProviderPlaceId: 'provider-place-b', action: 'already-present' as const,
      sourcePosition: 2,
    }],
  }
  const planDigest = await sha256(outboundExecutionPlanDigestInputV2(commitment))
  return {
    grant: {
      schemaVersion: 'outbound-execution-grant.v2' as const,
      grantId, operationId, transferId, connectionId, providerKey: 'naver' as const,
      accountFingerprint, installationId, operation: 'export-saved-library' as const,
      planDigest, token: 'opaque.connector.grant.token.that.is.long.enough',
      placeOrigin: 'https://place.example', issuedAt: '2026-09-03T00:00:00.000Z',
      expiresAt: '2026-09-03T00:05:00.000Z', limits,
      manifest: {
        schemaVersion: 'outbound-execution-manifest.v2' as const,
        ...commitment,
        planDigest,
      },
    },
    binding: {
      operationId, transferId, connectionId, providerKey: 'naver' as const,
      accountFingerprint, installationId, planDigest, sourceOrigin: 'https://place.example',
    },
    plan: { requestFingerprint },
  }
}

function operation() {
  return {
    schemaVersion: 'transfer-operation.v2' as const,
    operationId, kind: 'outbound-transfer' as const, providerKey: 'naver' as const,
    connectionId, accountLabel: 'NAVER',
    resource: { kind: 'outbound-transfer' as const, transferId },
    stage: 'reconciling' as const, state: 'outcome-unknown' as const,
    progress: { total: 1, processed: 1, applied: 0, failed: 0, outcomeUnknown: 1 },
    operationRevision: 'operation-r2', attemptCount: 1, nextAttemptAt: null,
    actionRequired: null, allowedActions: ['reconcile' as const], lastError: null,
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:03:00.000Z',
    completedAt: null,
  }
}

export type MemorySpool = Readonly<{
  port: OutboundAttemptSpool
  load(attemptId: string): OutboundAttemptSpoolEntry | undefined
  seed(entry: OutboundAttemptSpoolEntry): void
}>

export function memorySpool(calls: string[] = []): MemorySpool {
  const entries = new Map<string, OutboundAttemptSpoolEntry>()
  return {
    load: (id) => entries.get(id),
    seed: (entry) => entries.set(entry.attempt.attemptId, entry),
    port: {
      seal: async (attempt) => {
        const current = entries.get(attempt.attemptId)
        if (current !== undefined) {
          return JSON.stringify(current.attempt) === JSON.stringify(attempt) ? 'replayed' : 'conflict'
        }
        calls.push(`spool:seal:${attempt.phase}`)
        entries.set(attempt.attemptId, {
          attempt, state: 'sealed', updatedAt: attempt.sealedAt, retainUntil: null,
        })
        return 'sealed'
      },
      listPending: async ({ limit }) => [...entries.values()]
        .filter((entry) => entry.state !== 'completed').slice(0, limit),
      load: async (id) => entries.get(id) ?? null,
      acknowledgePrepared: async ({ attemptId: id, preparedAt }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        if (entry.state === 'prepared') return 'replayed'
        if (entry.state !== 'sealed') return 'conflict'
        calls.push(`spool:prepare:${entry.attempt.phase}`)
        entries.set(id, { ...entry, state: 'prepared', updatedAt: preparedAt })
        return 'acknowledged'
      },
      acknowledgeReported: async ({ attemptId: id, reportedAt }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        if (entry.state === 'reported') return 'replayed'
        if (entry.state !== 'prepared') return 'conflict'
        calls.push(`spool:report:${entry.attempt.phase}`)
        entries.set(id, { ...entry, state: 'reported', updatedAt: reportedAt })
        return 'acknowledged'
      },
      complete: async ({ attemptId: id, completedAt, retainUntil: retention }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        if (entry.state === 'completed') return 'replayed'
        if (entry.state !== 'reported') return 'conflict'
        calls.push(`spool:complete:${entry.attempt.phase}`)
        entries.set(id, {
          ...entry, state: 'completed', updatedAt: completedAt, retainUntil: retention,
        })
        return 'completed'
      },
      remove: async ({ attemptId: id, now: removalTime }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        if (
          entry.state !== 'completed' || entry.retainUntil === null ||
          Date.parse(removalTime) < Date.parse(entry.retainUntil)
        ) return 'retained'
        entries.delete(id)
        return 'removed'
      },
    },
  }
}

export type MemoryVault = Readonly<{
  port: OutboundReconciliationAuthorizationVault
  load(reference: string): Awaited<ReturnType<OutboundReconciliationAuthorizationVault['load']>>
}>

export function memoryVault(): MemoryVault {
  const entries = new Map<string, NonNullable<ReturnType<MemoryVault['load']>>>()
  return {
    load: (reference) => entries.get(reference) ?? null,
    port: {
      seal: async (authorization) => {
        const current = entries.get(authorization.receiptReference)
        if (current !== undefined) {
          return JSON.stringify(current) === JSON.stringify(authorization) ? 'replayed' : 'conflict'
        }
        entries.set(authorization.receiptReference, authorization)
        return 'sealed'
      },
      load: async (reference) => entries.get(reference) ?? null,
    },
  }
}

export function defaultTarget(
  calls: string[] = [],
  overrides: Partial<SavedPlaceTarget> = {},
): SavedPlaceTarget {
  return {
    providerKey: 'naver', capabilities: availableCapabilities,
    listTargetLists: vi.fn(),
    createTargetList: async ({ executionContext }) => {
      calls.push('provider:create')
      return {
        status: 'created',
        targetList: { targetListId: 'target-list-created', name: '도쿄 여행' },
        receiptReference: executionContext.reconciliationReference,
      }
    },
    reconcileCreateTargetList: async () => ({
      status: 'reconciled',
      targetList: { targetListId: 'target-list-reconciled', name: '도쿄 여행' },
      receiptReference: 'provider-create-reconciliation-receipt',
    }),
    preflight: vi.fn(),
    add: async ({ items }) => {
      calls.push('provider:add')
      return {
        status: 'completed', receiptReference: 'provider-add-receipt',
        items: items.map((item) => ({ exportItemId: item.exportItemId, status: 'applied' })),
      }
    },
    reconcile: async ({ items }) => ({
      status: 'reconciled', receiptReference: 'provider-reconciliation-receipt',
      items: items.map((item) => ({ exportItemId: item.exportItemId, status: 'present' })),
    }),
    ...overrides,
  }
}

function authorizationFor(prepared: PreparedApprovedExport) {
  return {
    schemaVersion: 'outbound-execution-authorization-receipt.v2' as const,
    status: 'consumed' as const, grantId, receiptReference, receiptToken:
      'opaque.execution.receipt.token.that.is.long.enough',
    operationId, transferId, connectionId, providerKey: 'naver' as const,
    accountFingerprint, installationId, planDigest: prepared.binding.planDigest,
    batchSize: prepared.batchSize, authorizedAt: '2026-09-03T00:01:00.000Z',
    expiresAt: '2026-09-03T00:05:00.000Z',
    reconciliationExpiresAt: '2026-09-04T00:01:00.000Z', limits,
  }
}

export function defaultControl(calls: string[] = []): OutboundExecutionControl {
  return {
    consume: async ({ request }) => {
      calls.push('backend:consume')
      return authorizationFor({
        binding: { ...request, transferId, sourceOrigin: request.sourceOrigin },
        plan: { requestFingerprint },
        grant: {} as PreparedApprovedExport['grant'],
        consumeRequest: request,
        batchSize: request.batchSize,
        batchCount: request.batchCount,
      })
    },
    prepareAttempt: async ({ intent }) => {
      calls.push(`backend:prepare:${intent.phase}`)
      return {
        schemaVersion: 'outbound-execution-attempt-intent-receipt.v2', outcome: 'recorded',
        operationId: intent.operationId, attemptId: intent.attemptId,
      }
    },
    recordAttempt: async ({ attempt }) => {
      calls.push(`backend:attempt:${attempt.phase}`)
      return {
        schemaVersion: 'outbound-execution-attempt-receipt.v2', outcome: 'recorded',
        operation: operation(),
      }
    },
    recordReconciliation: async ({ reconciliation }) => {
      calls.push(`backend:reconciliation:${reconciliation.phase}`)
      return {
        schemaVersion: 'outbound-execution-reconciliation-receipt.v2', outcome: 'recorded',
        operation: operation(),
      }
    },
  }
}

export type OutboundExportHarness = Readonly<{
  runtime: OutboundExportRuntime
  spool: MemorySpool
  vault: MemoryVault
  control: OutboundExecutionControl
  target: SavedPlaceTarget
}>

export function createHarness(input: Readonly<{
  calls?: string[]
  target?: SavedPlaceTarget
  control?: OutboundExecutionControl
  spool?: MemorySpool
  vault?: MemoryVault
}> = {}): OutboundExportHarness {
  const calls = input.calls ?? []
  const spool = input.spool ?? memorySpool(calls)
  const vault = input.vault ?? memoryVault()
  const control = input.control ?? defaultControl(calls)
  const target = input.target ?? defaultTarget(calls)
  const dependencies: OutboundExportRuntimeDependencies = {
    target, control, spool: spool.port, vault: vault.port,
  }
  return { runtime: composeOutboundExportRuntime('naver', dependencies), spool, vault, control, target }
}

export async function prepareAndAuthorize(
  harness: OutboundExportHarness,
  target: Readonly<
    { kind: 'existing-list'; targetListId: string } | { kind: 'new-list'; name: string }
  > = { kind: 'existing-list', targetListId: 'target-list-a' },
): Promise<Readonly<{ prepared: PreparedApprovedExport; authorized: AuthorizedApprovedExport }>> {
  const approved = await approvedGrant(target)
  const prepared = await harness.runtime.prepare({ ...approved, now: '2026-09-03T00:01:00.000Z' })
  const authorized = await harness.runtime.authorize({
    prepared, now, signal: new AbortController().signal,
  })
  return { prepared, authorized }
}

export function sealFrom(
  authorized: AuthorizedApprovedExport,
  overrides: Partial<OutboundAttemptSeal> = {},
): OutboundAttemptSeal {
  return {
    schemaVersion: 'outbound-attempt-seal.v1', operationId,
    receiptReference: authorized.authorization.receiptReference,
    attemptId, phase: 'add-items', targetListId: 'target-list-a', sequence: 0, final: true,
    requestFingerprint: `${requestFingerprint}:0`,
    planDigest: authorized.prepared.binding.planDigest,
    reconciliationReference: 'provider-attempt-a',
    items: [{ exportItemId: itemKey, providerPlaceId: 'provider-place-a', position: 1 }],
    sealedAt: now, writeExpiresAt: authorized.authorization.expiresAt,
    reconciliationExpiresAt: authorized.authorization.reconciliationExpiresAt,
    ...overrides,
  }
}
