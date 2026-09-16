import { describe, expect, it } from 'vitest'

import type { OutboundExecutionControl } from '../ports/execution-control.js'
import { readSavedPlaceTargetCapabilities } from '../target-catalog.js'
import { composeOutboundExportRuntime } from '../index.js'
import {
  accountFingerprint,
  approvedGrant,
  availableCapabilities,
  connectionId,
  createHarness,
  defaultControl,
  defaultTarget,
  grantId,
  installationId,
  memorySpool,
  memoryVault,
  now,
  operationId,
} from './outbound-export-test-kit.js'

describe('outbound export authorization behavior', () => {
  it('keeps the consume request token-free and binds authorization to the exact plan', async () => {
    const harness = createHarness()
    const approved = await approvedGrant()
    const prepared = await harness.runtime.prepare({
      ...approved, now: '2026-09-03T00:01:00.000Z',
    })

    expect(prepared.consumeRequest).toMatchObject({
      grantId, operationId, connectionId, accountFingerprint, installationId,
      itemCount: 1, batchSize: 100,
    })
    expect(JSON.stringify(prepared.consumeRequest)).not.toContain(approved.grant.token)
    expect(prepared).not.toHaveProperty('authorization')

    const baseline = defaultControl()
    const invalidControl: OutboundExecutionControl = {
      ...baseline,
      consume: async (input) => {
        const receipt = await baseline.consume(input)
        if ('status' in receipt && receipt.status !== 'consumed') return receipt
        return { ...receipt, connectionId: '99999999-9999-4999-8999-999999999999' }
      },
    }
    const invalidRuntime = composeOutboundExportRuntime('naver', {
      target: defaultTarget(), control: invalidControl,
      spool: memorySpool().port, vault: memoryVault().port,
    })
    await expect(invalidRuntime.authorize({
      prepared, now, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'binding-mismatch' })
  })

  it('rejects item substitution that no longer matches the approved plan digest', async () => {
    const harness = createHarness()
    const approved = await approvedGrant()
    const changed = {
      ...approved.grant,
      manifest: {
        ...approved.grant.manifest,
        items: approved.grant.manifest.items.map((item) => ({
          ...item, targetProviderPlaceId: 'substituted-provider-place',
        })),
      },
    }

    await expect(harness.runtime.prepare({
      grant: changed,
      binding: approved.binding,
      plan: approved.plan,
      now: '2026-09-03T00:01:00.000Z',
    })).rejects.toMatchObject({ code: 'provider-result-invalid' })
  })

  it('rejects a production capability until a verified target Adapter is available', () => {
    const gated = readSavedPlaceTargetCapabilities('naver')
    expect(() => composeOutboundExportRuntime('naver', {
      target: defaultTarget([], { capabilities: gated }),
      control: defaultControl(), spool: memorySpool().port, vault: memoryVault().port,
    })).toThrow('Connector export runtime is not available for naver')

    expect(availableCapabilities.deliveryState).toBe('available')
  })
})
