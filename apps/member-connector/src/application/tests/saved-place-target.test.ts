import { describe, expect, it } from 'vitest'

import {
  listSavedPlaceTargetCapabilities,
  readSavedPlaceTargetCapabilities,
} from '../outbound-export/index.js'
import type { SavedPlaceTarget } from '../outbound-export/index.js'

describe('SavedPlaceTarget outbound boundary', () => {
  it('keeps every unverified Provider write capability gated or unavailable', () => {
    expect(listSavedPlaceTargetCapabilities().map((entry) => ({
      providerKey: entry.providerKey,
      deliveryState: entry.deliveryState,
      transport: entry.transport,
    }))).toEqual([
      { providerKey: 'naver', deliveryState: 'integration-gated', transport: null },
      { providerKey: 'google', deliveryState: 'unavailable', transport: null },
      { providerKey: 'kakao', deliveryState: 'unavailable', transport: null },
    ])
    for (const entry of listSavedPlaceTargetCapabilities()) {
      expect(Object.values(entry.capabilities)).not.toContain('available')
      expect(entry.maximumAddItems).toBeNull()
    }
    expect(readSavedPlaceTargetCapabilities('naver').evidence.kind).toBe('research-required')
  })

  it('represents preflight, idempotent add, unknown outcome, and reconciliation independently', async () => {
    const target: SavedPlaceTarget = {
      providerKey: 'naver',
      capabilities: readSavedPlaceTargetCapabilities('naver'),
      listTargetLists: async () => ({
        status: 'action-required', reason: 'reauth-required',
      }),
      createTargetList: async () => ({
        status: 'unsupported', capability: 'create-target-list',
      }),
      reconcileCreateTargetList: async () => ({
        status: 'unsupported', capability: 'reconcile-create-target-list',
      }),
      preflight: async () => ({
        status: 'rate-limited', retryAfterMilliseconds: 5_000,
      }),
      add: async () => ({
        status: 'outcome-unknown', reconciliationReference: 'provider-attempt:opaque',
      }),
      reconcile: async (input) => ({
        status: 'reconciled',
        receiptReference: 'provider-receipt:opaque',
        items: input.items.map((item) => ({ exportItemId: item.exportItemId, status: 'present' })),
      }),
    }
    const signal = new AbortController().signal
    const authorizedOperationId = crypto.randomUUID()
    const authorization = {
      schemaVersion: 'outbound-execution-authorization-receipt.v2' as const,
      status: 'consumed' as const,
      grantId: '11111111-1111-4111-8111-111111111111',
      receiptReference: 'backend-receipt:opaque',
      operationId: authorizedOperationId,
      transferId: '22222222-2222-4222-8222-222222222222',
      connectionId: '33333333-3333-4333-8333-333333333333',
      providerKey: 'naver' as const,
      accountFingerprint: 'a'.repeat(64),
      installationId: '44444444-4444-4444-8444-444444444444',
      planDigest: 'b'.repeat(64),
      batchSize: 100,
      authorizedAt: '2026-09-03T00:00:00.000Z',
      expiresAt: '2026-09-03T00:05:00.000Z',
      reconciliationExpiresAt: '2026-09-03T00:10:00.000Z',
      limits: { maximumItems: 100, maximumBytes: 10_000, maximumBatches: 10 },
    }

    await expect(target.listTargetLists({ signal })).resolves.toEqual({
      status: 'action-required', reason: 'reauth-required',
    })
    await expect(target.createTargetList({
      commandId: crypto.randomUUID(), requestFingerprint: 'a'.repeat(64),
      authorization,
      executionContext: {
        attemptId: crypto.randomUUID(),
        reconciliationReference: 'local-create-attempt:opaque',
      },
      name: '도쿄', signal,
    })).resolves.toEqual({ status: 'unsupported', capability: 'create-target-list' })
    await expect(target.preflight({
      planDigest: 'b'.repeat(64), targetListId: 'target-list', places: [], signal,
    })).resolves.toEqual({ status: 'rate-limited', retryAfterMilliseconds: 5_000 })
    await expect(target.add({
      operationId: authorizedOperationId,
      requestFingerprint: 'c'.repeat(64),
      planDigest: 'b'.repeat(64),
      authorization,
      executionContext: {
        attemptId: crypto.randomUUID(),
        reconciliationReference: 'local-add-attempt:opaque',
      },
      preflightReference: 'preflight:opaque',
      targetListId: 'target-list',
      items: [],
      signal,
    })).resolves.toEqual({
      status: 'outcome-unknown', reconciliationReference: 'provider-attempt:opaque',
    })
    await expect(target.reconcile({
      operationId: authorizedOperationId,
      requestFingerprint: 'c'.repeat(64),
      targetListId: 'target-list',
      reconciliationReference: 'provider-attempt:opaque',
      items: [{ exportItemId: 'export-item', providerPlaceId: 'provider-place' }],
      signal,
    })).resolves.toMatchObject({
      status: 'reconciled', items: [{ exportItemId: 'export-item', status: 'present' }],
    })
  })
})
