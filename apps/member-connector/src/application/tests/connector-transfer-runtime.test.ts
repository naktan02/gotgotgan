import { describe, expect, it, vi } from 'vitest'

import { composeConnectorTransferRuntime } from '../connector-transfer-runtime.js'
import { readSavedPlaceTargetCapabilities } from '../outbound-export/index.js'
import type { AuthorizedApprovedExport } from '../outbound-export/index.js'
import type {
  OutboundAttemptSeal,
  OutboundAttemptSpool,
  OutboundAttemptSpoolEntry,
} from '../outbound-export/index.js'
import type { OutboundExecutionControl } from '../outbound-export/index.js'
import type {
  OutboundReconciliationAuthorizationVault,
} from '../outbound-export/index.js'
import type {
  SavedPlaceTarget,
  SavedPlaceTargetCapabilities,
  SavedPlaceTargetCapability,
} from '../outbound-export/index.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const transferId = '22222222-2222-4222-8222-222222222222'
const connectionId = '33333333-3333-4333-8333-333333333333'
const installationId = '44444444-4444-4444-8444-444444444444'
const grantId = '55555555-5555-4555-8555-555555555555'
const receiptReference = '66666666-6666-4666-8666-666666666666'
const attemptId = '77777777-7777-4777-8777-777777777777'
const itemKey = '88888888-8888-4888-8888-888888888888'
const placeId = '99999999-9999-4999-8999-999999999999'
const planDigest = 'a'.repeat(64)
const accountFingerprint = 'b'.repeat(64)

const capabilityKeys = [
  'list-target-lists', 'create-target-list', 'resolve-places', 'preflight-add', 'add-places',
  'reconcile-create-target-list', 'reconcile-add',
] as const satisfies readonly SavedPlaceTargetCapability[]

const availableCapabilities: SavedPlaceTargetCapabilities = {
  providerKey: 'naver', deliveryState: 'available', transport: 'browser-session',
  capabilities: Object.fromEntries(capabilityKeys.map((key) => [key, 'available'])) as
    Record<SavedPlaceTargetCapability, 'available'>,
  maximumAddItems: 100, preservesOrder: 'supported', acceptsPrivateNotes: 'unsupported',
  evidence: { kind: 'verified-adapter', summary: 'Deterministic test adapter.' },
}

function memorySpool(calls: string[]): Readonly<{
  spool: OutboundAttemptSpool
  load(attemptId: string): OutboundAttemptSpoolEntry | undefined
}> {
  const entries = new Map<string, OutboundAttemptSpoolEntry>()
  return {
    load: (id) => entries.get(id),
    spool: {
      seal: async (attempt) => {
        calls.push('spool:sealed')
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
        calls.push('spool:prepared')
        entries.set(id, { ...entry, state: 'prepared', updatedAt: preparedAt })
        return 'acknowledged'
      },
      acknowledgeReported: async ({ attemptId: id, reportedAt }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        calls.push('spool:reported')
        entries.set(id, { ...entry, state: 'reported', updatedAt: reportedAt })
        return 'acknowledged'
      },
      complete: async ({ attemptId: id, completedAt, retainUntil }) => {
        const entry = entries.get(id)
        if (entry === undefined) return 'not-found'
        entries.set(id, { ...entry, state: 'completed', updatedAt: completedAt, retainUntil })
        return 'completed'
      },
      remove: async () => 'retained',
    },
  }
}

function authorized(): AuthorizedApprovedExport {
  const limits = { maximumItems: 100, maximumBytes: 100_000, maximumBatches: 10 }
  const manifest = {
    schemaVersion: 'outbound-execution-manifest.v2' as const,
    operationId, transferId, connectionId, providerKey: 'naver' as const,
    accountFingerprint, collectionId: placeId, collectionRevision: 'collection-r1',
    targetObservationRevision: 'target-r1',
    target: { kind: 'existing-list' as const, targetListId: 'list-a' },
    planDigest,
    items: [{ itemKey, placeId, targetProviderPlaceId: 'provider-place-a',
      action: 'add' as const, sourcePosition: 0 }],
  }
  const grant = {
    schemaVersion: 'outbound-execution-grant.v2' as const,
    grantId, operationId, transferId, connectionId, providerKey: 'naver' as const,
    accountFingerprint, installationId, operation: 'export-saved-library' as const,
    planDigest, token: 'opaque.connector.grant.token.that.is.long.enough',
    placeOrigin: 'https://place.example', issuedAt: '2026-09-03T00:00:00.000Z',
    expiresAt: '2026-09-03T00:30:00.000Z', limits, manifest,
  }
  return {
    prepared: {
      grant,
      binding: {
        operationId, transferId, connectionId, providerKey: 'naver', accountFingerprint,
        installationId, planDigest, sourceOrigin: 'https://place.example',
      },
      plan: { requestFingerprint: 'c'.repeat(64) },
      consumeRequest: {
        schemaVersion: 'outbound-execution-consume-request.v2', grantId, operationId,
        connectionId, providerKey: 'naver', accountFingerprint, installationId, planDigest,
        sourceOrigin: 'https://place.example', itemCount: 1, byteCount: 1_024,
        batchCount: 1, batchSize: 100,
      },
      batchSize: 100, batchCount: 1,
    },
    authorization: {
      schemaVersion: 'outbound-execution-authorization-receipt.v2', status: 'consumed',
      grantId, receiptReference,
      receiptToken: 'opaque.execution.receipt.token.that.is.long.enough',
      operationId, transferId, connectionId, providerKey: 'naver', accountFingerprint,
      installationId, planDigest, batchSize: 100,
      authorizedAt: '2026-09-03T00:01:00.000Z',
      expiresAt: '2026-09-03T00:30:00.000Z',
      reconciliationExpiresAt: '2026-09-04T00:01:00.000Z', limits,
    },
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

function target(add: SavedPlaceTarget['add'], capabilities = availableCapabilities): SavedPlaceTarget {
  return {
    providerKey: 'naver', capabilities,
    listTargetLists: vi.fn(), createTargetList: vi.fn(), reconcileCreateTargetList: vi.fn(),
    preflight: vi.fn(), add, reconcile: vi.fn(),
  }
}

describe('Connector v2 transfer runtime composition', () => {
  it('keeps uncomposed imports and exports unavailable instead of falling back to v1', () => {
    const runtime = composeConnectorTransferRuntime()
    expect(runtime.capabilities).toEqual({ importProviders: [], exportProviders: [] })
  })

  it('rejects an integration-gated Provider target before it can be invoked', () => {
    const gated = readSavedPlaceTargetCapabilities('naver')
    expect(() => composeConnectorTransferRuntime({
      exports: new Map([['naver', {
        target: target(vi.fn(), gated), control: {} as OutboundExecutionControl,
        spool: {} as OutboundAttemptSpool,
        vault: {} as OutboundReconciliationAuthorizationVault,
      }]]),
    })).toThrow('Connector export runtime is not available for naver')
  })

  it('turns a synchronous Provider failure into a retained unknown outcome after durable intent', async () => {
    const calls: string[] = []
    let providerInput: unknown
    const local = memorySpool(calls)
    const provider = target(((input) => {
      providerInput = input
      calls.push('provider:add')
      throw new Error('response lost')
    }) as SavedPlaceTarget['add'])
    const control: OutboundExecutionControl = {
      consume: vi.fn(),
      prepareAttempt: async ({ intent }) => {
        calls.push('backend:intent')
        return {
          schemaVersion: 'outbound-execution-attempt-intent-receipt.v2', outcome: 'recorded',
          operationId: intent.operationId, attemptId: intent.attemptId,
        }
      },
      recordAttempt: async () => {
        calls.push('backend:attempt')
        return {
          schemaVersion: 'outbound-execution-attempt-receipt.v2', outcome: 'recorded',
          operation: operation(),
        }
      },
      recordReconciliation: vi.fn(),
    }
    const runtime = composeConnectorTransferRuntime({
      exports: new Map([['naver', {
        target: provider, control, spool: local.spool,
        vault: { seal: vi.fn(), load: vi.fn() },
      }]]),
    }).exports.get('naver')!
    const attempt = await runtime.addItems({
      authorized: authorized(), attemptId, reconciliationReference: 'reconcile-a',
      targetListId: 'list-a', sequence: 0, now: '2026-09-03T00:02:00.000Z',
      retainUntil: '2026-09-05T00:00:00.000Z', signal: new AbortController().signal,
    })

    expect(calls).toEqual([
      'spool:sealed', 'backend:intent', 'spool:prepared', 'provider:add',
      'backend:attempt', 'spool:reported',
    ])
    expect(attempt.outcome).toBe('outcome-unknown')
    expect(local.load(attemptId)?.state).toBe('reported')
    expect(JSON.stringify(providerInput)).not.toContain('opaque.execution.receipt.token')
    expect(JSON.stringify(local.load(attemptId))).not.toContain('opaque.execution.receipt.token')
  })
})
