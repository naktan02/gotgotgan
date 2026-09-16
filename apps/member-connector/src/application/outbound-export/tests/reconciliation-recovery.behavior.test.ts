import { describe, expect, it } from 'vitest'

import type { SavedPlaceTarget } from '../ports/saved-place-target.js'
import {
  attemptId,
  createHarness,
  defaultTarget,
  itemKey,
  now,
  prepareAndAuthorize,
  reconciliationId,
  retainUntil,
  sealFrom,
} from './outbound-export-test-kit.js'

const requestedItems = [
  { exportItemId: itemKey, providerPlaceId: 'provider-place-a', position: 1 },
]

describe('outbound export reconciliation and recovery behavior', () => {
  it('keeps an unknown item attempt pending until fresh reconciliation resolves it', async () => {
    const target = defaultTarget([], {
      add: (async ({ executionContext }) => ({
        status: 'outcome-unknown',
        reconciliationReference: executionContext.reconciliationReference,
      })) as SavedPlaceTarget['add'],
    })
    const harness = createHarness({ target })
    const { authorized } = await prepareAndAuthorize(harness)
    const attempt = await harness.runtime.addItems({
      authorized, attemptId, reconciliationReference: 'provider-attempt-a',
      targetListId: 'target-list-a', sequence: 0, now, retainUntil,
      signal: new AbortController().signal,
    })
    expect(harness.spool.load(attemptId)?.state).toBe('reported')

    const reconciliation = await harness.runtime.reconcileItems({
      authorized, attempt, reconciliationId, requestedItems,
      now: '2026-09-03T00:03:00.000Z', retainUntil,
      signal: new AbortController().signal,
    })

    expect(reconciliation).toMatchObject({
      reconciliationId, outcome: 'resolved-completed',
      items: [{ itemKey, status: 'present' }],
    })
    expect(harness.spool.load(attemptId)).toMatchObject({
      state: 'completed', retainUntil,
    })
  })

  it('leaves reconciliation unknown without completing retained history', async () => {
    const target = defaultTarget([], {
      add: (async ({ executionContext }) => ({
        status: 'outcome-unknown',
        reconciliationReference: executionContext.reconciliationReference,
      })) as SavedPlaceTarget['add'],
      reconcile: (async ({ reconciliationReference }) => ({
        status: 'outcome-unknown', reconciliationReference,
      })) as SavedPlaceTarget['reconcile'],
    })
    const harness = createHarness({ target })
    const { authorized } = await prepareAndAuthorize(harness)
    const attempt = await harness.runtime.addItems({
      authorized, attemptId, reconciliationReference: 'provider-attempt-a',
      targetListId: 'target-list-a', sequence: 0, now, retainUntil,
      signal: new AbortController().signal,
    })
    const reconciliation = await harness.runtime.reconcileItems({
      authorized, attempt, reconciliationId, requestedItems,
      now: '2026-09-03T00:03:00.000Z', retainUntil,
      signal: new AbortController().signal,
    })

    expect(reconciliation.outcome).toBe('still-unknown')
    expect(harness.spool.load(attemptId)?.state).toBe('reported')
  })

  it('retains a target-list identity learned only during reconciliation', async () => {
    const target = defaultTarget([], {
      createTargetList: (async ({ executionContext }) => ({
        status: 'outcome-unknown',
        reconciliationReference: executionContext.reconciliationReference,
      })) as SavedPlaceTarget['createTargetList'],
    })
    const harness = createHarness({ target })
    const { authorized } = await prepareAndAuthorize(
      harness, { kind: 'new-list', name: '도쿄 여행' },
    )
    const attempt = await harness.runtime.createTargetList({
      authorized, attemptId, reconciliationReference: 'provider-create-attempt',
      now, retainUntil, signal: new AbortController().signal,
    })
    const reconciliation = await harness.runtime.reconcileTargetList({
      authorized, attempt, reconciliationId,
      now: '2026-09-03T00:03:00.000Z', retainUntil,
      signal: new AbortController().signal,
    })

    expect(reconciliation).toMatchObject({
      outcome: 'resolved-completed', targetListId: 'target-list-reconciled',
    })
    expect(harness.spool.load(attemptId)?.state).toBe('completed')
  })

  it('recovers sealed and prepared crash points without invoking the Provider', async () => {
    const calls: string[] = []
    const target = defaultTarget(calls)
    const harness = createHarness({ calls, target })
    const { authorized } = await prepareAndAuthorize(harness)
    const sealed = sealFrom(authorized)
    harness.spool.seed({
      attempt: sealed, state: 'sealed', updatedAt: sealed.sealedAt, retainUntil: null,
    })
    calls.length = 0

    const recovered = await harness.runtime.resumePending({
      now: '2026-09-03T00:03:00.000Z', signal: new AbortController().signal,
    })

    expect(recovered).toMatchObject([{
      attemptId, state: 'reported', attempt: { outcome: 'outcome-unknown' },
    }])
    expect(calls).toEqual([
      'backend:prepare:add-items', 'spool:prepare:add-items',
      'backend:attempt:add-items', 'spool:report:add-items',
    ])
    expect(calls).not.toContain('provider:add')
  })

  it('returns reported records ready for reconciliation and bounds recovery pages', async () => {
    const harness = createHarness()
    const { authorized } = await prepareAndAuthorize(harness)
    const sealed = sealFrom(authorized)
    harness.spool.seed({
      attempt: sealed, state: 'reported', updatedAt: now, retainUntil: null,
    })

    const recovered = await harness.runtime.resumePending({
      now: '2026-09-03T00:03:00.000Z', signal: new AbortController().signal, limit: 1,
    })
    expect(recovered[0]).toMatchObject({ attemptId, state: 'ready-to-reconcile' })

    await expect(harness.runtime.resumePending({
      now: '2026-09-03T00:03:00.000Z', signal: new AbortController().signal, limit: 101,
    })).rejects.toMatchObject({ code: 'provider-result-invalid' })
  })
})
