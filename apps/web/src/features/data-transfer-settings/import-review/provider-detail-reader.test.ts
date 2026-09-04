import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  DataTransferSettingsGateway,
  ImportPlanPreview,
} from '../data-transfer-settings-model'
import { DataTransferSettingsProblem } from '../data-transfer-settings-model'
import {
  createProviderDetailPlanReader,
  startProviderDetailSyncSession,
  type ProviderDetailSyncHost,
} from './use-provider-detail-sync'

function preview(
  planRevision: string,
  providerDetails: ImportPlanPreview['providerDetails'],
): ImportPlanPreview {
  return {
    planId: 'plan-id', planRevision, snapshotId: 'snapshot-id', snapshotRevision: 'snapshot-r1',
    mappings: [], summary: { add: 0, alreadyPresent: 0, reviewRequired: 1, unsupported: 0 },
    providerDetails, matches: [], approvalEligible: false,
  }
}

function gateway(methods: Partial<DataTransferSettingsGateway>): DataTransferSettingsGateway {
  return methods as DataTransferSettingsGateway
}

function syncHost() {
  const focus = new Set<() => void>()
  const visibility = new Set<() => void>()
  const host: ProviderDetailSyncHost = {
    isHidden: () => false,
    onFocus(listener) {
      focus.add(listener)
      return () => focus.delete(listener)
    },
    onVisibilityChange(listener) {
      visibility.add(listener)
      return () => visibility.delete(listener)
    },
  }
  return {
    host,
    focus: () => focus.forEach((listener) => listener()),
    listenerCount: () => focus.size + visibility.size,
  }
}

describe('provider detail plan reader', () => {
  afterEach(() => vi.useRealTimers())

  it('polls with GET only while detail is pending', async () => {
    const current = preview('plan-r1', { pending: 1, available: 0, unavailable: 0 })
    const importPlan = vi.fn().mockResolvedValue(current)
    const refreshImportEvidence = vi.fn()
    const reader = createProviderDetailPlanReader(gateway({
      importPlan, refreshImportEvidence,
    }), 'plan-id', () => 'command-id')

    await expect(reader.read()).resolves.toBe(current)
    expect(importPlan).toHaveBeenCalledTimes(1)
    expect(refreshImportEvidence).not.toHaveBeenCalled()
  })

  it('reuses the same refresh command after an ambiguous failure', async () => {
    const available = preview('plan-r1', { pending: 0, available: 1, unavailable: 0 })
    const refreshed = preview('plan-r2', { pending: 0, available: 0, unavailable: 0 })
    const refreshImportEvidence = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(refreshed)
    const reader = createProviderDetailPlanReader(gateway({
      importPlan: vi.fn().mockResolvedValue(available), refreshImportEvidence,
    }), 'plan-id', () => 'stable-command-id')

    await expect(reader.read()).rejects.toThrow('response lost')
    await expect(reader.read()).resolves.toBe(refreshed)
    expect(refreshImportEvidence.mock.calls.map(([input]) => input.commandId))
      .toEqual(['stable-command-id', 'stable-command-id'])
  })

  it('recovers a revision race by reading the latest plan', async () => {
    const available = preview('plan-r1', { pending: 0, available: 1, unavailable: 0 })
    const latest = preview('plan-r2', { pending: 0, available: 0, unavailable: 1 })
    const importPlan = vi.fn().mockResolvedValueOnce(available).mockResolvedValueOnce(latest)
    const reader = createProviderDetailPlanReader(gateway({
      importPlan,
      refreshImportEvidence: vi.fn().mockRejectedValue(new DataTransferSettingsProblem(409)),
    }), 'plan-id', () => 'command-id')

    await expect(reader.read()).resolves.toBe(latest)
    expect(importPlan).toHaveBeenCalledTimes(2)
  })

  it('does not replace a newer user decision with a late polling response', async () => {
    vi.useFakeTimers()
    const stale = preview('plan-r1', { pending: 0, available: 0, unavailable: 1 })
    let current = preview('plan-r1', { pending: 1, available: 0, unavailable: 0 })
    let resolve: ((value: ImportPlanPreview) => void) | undefined
    const importPlan = vi.fn(() => new Promise<ImportPlanPreview>((done) => { resolve = done }))
    const browser = syncHost()
    const onPreview = vi.fn((next: ImportPlanPreview) => { current = next })
    const stop = startProviderDetailSyncSession({
      gateway: gateway({ importPlan, refreshImportEvidence: vi.fn() }),
      planId: 'plan-id', getPreview: () => current, onPreview, onState: vi.fn(),
      host: browser.host, activeDelayMilliseconds: 1,
    })
    await vi.advanceTimersByTimeAsync(1)

    current = preview('plan-r2', { pending: 0, available: 0, unavailable: 0 })
    resolve?.(stale)
    await vi.advanceTimersByTimeAsync(0)
    browser.focus()
    await vi.advanceTimersByTimeAsync(10)

    expect(onPreview).not.toHaveBeenCalled()
    expect(current.planRevision).toBe('plan-r2')
    expect(importPlan).toHaveBeenCalledTimes(1)
    stop()
  })

  it('detaches wake listeners after the final provider detail becomes terminal', async () => {
    vi.useFakeTimers()
    let current = preview('plan-r1', { pending: 1, available: 0, unavailable: 0 })
    const terminal = preview('plan-r1', { pending: 0, available: 0, unavailable: 1 })
    const importPlan = vi.fn().mockResolvedValue(terminal)
    const browser = syncHost()
    const stop = startProviderDetailSyncSession({
      gateway: gateway({ importPlan, refreshImportEvidence: vi.fn() }),
      planId: 'plan-id', getPreview: () => current,
      onPreview: (next) => { current = next }, onState: vi.fn(),
      host: browser.host, activeDelayMilliseconds: 1,
    })
    expect(browser.listenerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)

    expect(browser.listenerCount()).toBe(0)
    browser.focus()
    await vi.advanceTimersByTimeAsync(10)
    expect(importPlan).toHaveBeenCalledTimes(1)
    stop()
  })
})
