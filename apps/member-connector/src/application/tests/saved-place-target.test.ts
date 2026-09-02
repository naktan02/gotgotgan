import { describe, expect, it } from 'vitest'

import {
  listSavedPlaceTargetCapabilities,
  readSavedPlaceTargetCapabilities,
} from '../saved-place-target-catalog.js'
import type { SavedPlaceTarget } from '../ports/saved-place-target.js'

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
      receiptReference: 'backend-receipt:opaque',
      operationId: authorizedOperationId,
      providerKey: 'naver' as const,
      planDigest: 'b'.repeat(64),
      expiresAt: '2026-09-03T00:05:00.000Z',
    }

    await expect(target.listTargetLists({ signal })).resolves.toEqual({
      status: 'action-required', reason: 'reauth-required',
    })
    await expect(target.createTargetList({
      commandId: crypto.randomUUID(), requestFingerprint: 'a'.repeat(64),
      authorization, name: '도쿄', signal,
    })).resolves.toEqual({ status: 'unsupported', capability: 'create-target-list' })
    await expect(target.preflight({
      planDigest: 'b'.repeat(64), targetListId: 'target-list', places: [], signal,
    })).resolves.toEqual({ status: 'rate-limited', retryAfterMilliseconds: 5_000 })
    await expect(target.add({
      operationId: authorizedOperationId,
      requestFingerprint: 'c'.repeat(64),
      planDigest: 'b'.repeat(64),
      authorization,
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
