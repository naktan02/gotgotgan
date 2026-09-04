import { describe, expect, it } from 'vitest'

import type { SavedPlaceTarget } from '../ports/saved-place-target.js'
import {
  attemptId,
  createHarness,
  defaultTarget,
  now,
  prepareAndAuthorize,
  retainUntil,
} from './outbound-export-test-kit.js'

describe('outbound export execution journal behavior', () => {
  it('orders local seal, Backend intent, Provider mutation and terminal retention', async () => {
    const calls: string[] = []
    let providerInput: unknown
    const target = defaultTarget(calls, {
      add: (async (input) => {
        providerInput = input
        calls.push('provider:add')
        return {
          status: 'completed', receiptReference: 'provider-add-receipt',
          items: input.items.map((item) => ({
            exportItemId: item.exportItemId, status: 'already-present',
          })),
        }
      }) as SavedPlaceTarget['add'],
    })
    const harness = createHarness({ calls, target })
    const { authorized } = await prepareAndAuthorize(harness)
    calls.length = 0

    const attempt = await harness.runtime.addItems({
      authorized, attemptId, reconciliationReference: 'provider-attempt-a',
      targetListId: 'target-list-a', sequence: 0, now, retainUntil,
      signal: new AbortController().signal,
    })

    expect(calls).toEqual([
      'spool:seal:add-items', 'backend:prepare:add-items', 'spool:prepare:add-items',
      'provider:add', 'backend:attempt:add-items', 'spool:report:add-items',
      'spool:complete:add-items',
    ])
    expect(attempt).toMatchObject({
      outcome: 'completed', final: true,
      items: [{ status: 'already-present', itemKey: authorized.prepared.grant.manifest.items[0]!.itemKey }],
    })
    expect(harness.spool.load(attemptId)?.state).toBe('completed')
    expect(JSON.stringify(providerInput)).not.toContain(authorized.authorization.receiptToken)
    expect(JSON.stringify(harness.spool.load(attemptId))).not.toContain(
      authorized.authorization.receiptToken,
    )
  })

  it('turns a synchronous Provider response loss into a reported unknown outcome', async () => {
    const calls: string[] = []
    const target = defaultTarget(calls, {
      add: (() => {
        calls.push('provider:add')
        throw new Error('response lost')
      }) as SavedPlaceTarget['add'],
    })
    const harness = createHarness({ calls, target })
    const { authorized } = await prepareAndAuthorize(harness)
    calls.length = 0

    const attempt = await harness.runtime.addItems({
      authorized, attemptId, reconciliationReference: 'provider-attempt-a',
      targetListId: 'target-list-a', sequence: 0, now, retainUntil,
      signal: new AbortController().signal,
    })

    expect(attempt).toMatchObject({
      outcome: 'outcome-unknown', reconciliationReference: 'provider-attempt-a',
    })
    expect(harness.spool.load(attemptId)?.state).toBe('reported')
    expect(calls).not.toContain('spool:complete:add-items')
  })

  it('creates a target list as a distinct phase-final journal entry', async () => {
    const calls: string[] = []
    const harness = createHarness({ calls })
    const { authorized } = await prepareAndAuthorize(
      harness, { kind: 'new-list', name: '도쿄 여행' },
    )
    calls.length = 0

    const attempt = await harness.runtime.createTargetList({
      authorized, attemptId, reconciliationReference: 'provider-create-attempt',
      now, retainUntil, signal: new AbortController().signal,
    })

    expect(attempt).toMatchObject({
      phase: 'create-target-list', final: true, outcome: 'completed',
      targetListId: 'target-list-created',
    })
    expect(calls).toEqual([
      'spool:seal:create-target-list', 'backend:prepare:create-target-list',
      'spool:prepare:create-target-list', 'provider:create',
      'backend:attempt:create-target-list', 'spool:report:create-target-list',
      'spool:complete:create-target-list',
    ])
  })

  it('fails closed when the same Provider attempt is requested again', async () => {
    const harness = createHarness()
    const { authorized } = await prepareAndAuthorize(harness)
    const input = {
      authorized, attemptId, reconciliationReference: 'provider-attempt-a',
      targetListId: 'target-list-a', sequence: 0, now, retainUntil,
      signal: new AbortController().signal,
    }
    await harness.runtime.addItems(input)

    await expect(harness.runtime.addItems(input)).rejects.toMatchObject({
      code: 'attempt-not-sealed',
    })
  })
})
