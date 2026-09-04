'use client'

import { useEffect, useState } from 'react'

import { createPollController } from '../../../shared/async/poll-controller'
import type { PollController } from '../../../shared/async/poll-controller'

import type {
  DataTransferSettingsGateway,
  ImportPlanPreview,
} from '../data-transfer-settings-model'
import { DataTransferSettingsProblem } from '../data-transfer-settings-model'

export type ProviderDetailSyncState =
  | Readonly<{ kind: 'idle' | 'checking' }>
  | Readonly<{ kind: 'error'; message: string }>

type ProviderDetailSyncInput = Readonly<{
  active: boolean
  gateway: DataTransferSettingsGateway
  preview?: ImportPlanPreview
  getPreview(): ImportPlanPreview | undefined
  onPreview(preview: ImportPlanPreview): void
}>

export type ProviderDetailSyncHost = Readonly<{
  isHidden(): boolean
  onFocus(listener: () => void): () => void
  onVisibilityChange(listener: () => void): () => void
}>

export function createProviderDetailPlanReader(
  gateway: DataTransferSettingsGateway,
  planId: string,
  createCommandId: () => string = () => crypto.randomUUID(),
) {
  const commandIds = new Map<string, string>()
  return {
    async read(signal?: AbortSignal) {
      const current = await gateway.importPlan(planId, signal)
      if (current.providerDetails.available === 0) return current
      const revision = current.planRevision
      const commandId = commandIds.get(revision) ?? createCommandId()
      commandIds.set(revision, commandId)
      try {
        const refreshed = await gateway.refreshImportEvidence({
          commandId, planId, expectedPlanRevision: revision,
        }, signal)
        commandIds.delete(revision)
        return refreshed
      } catch (error) {
        if (!(error instanceof DataTransferSettingsProblem) || error.status !== 409) throw error
        commandIds.delete(revision)
        return gateway.importPlan(planId, signal)
      }
    },
    clear() { commandIds.clear() },
  }
}

function terminal(error: unknown): boolean {
  return error instanceof DataTransferSettingsProblem &&
    (error.status === 401 || error.status === 403 || error.status === 404)
}

function message(error: unknown, retrying: boolean): string {
  if (error instanceof DataTransferSettingsProblem && error.status === 401) {
    return '로그인이 만료되어 상세 확인을 중단했습니다.'
  }
  if (error instanceof DataTransferSettingsProblem && error.status === 403) {
    return '이 가져오기의 상세 상태를 확인할 권한이 없습니다.'
  }
  if (error instanceof DataTransferSettingsProblem && error.status === 404) {
    return '가져오기 미리보기를 더 이상 찾을 수 없습니다.'
  }
  return retrying
    ? '상세 상태를 확인하지 못했습니다. 잠시 후 자동으로 다시 시도합니다.'
    : '상세 상태를 확인하지 못했습니다.'
}

function needsProviderDetailSync(preview: ImportPlanPreview | undefined): boolean {
  return preview !== undefined &&
    (preview.providerDetails.pending > 0 || preview.providerDetails.available > 0)
}

type ProviderDetailRead = Readonly<{
  expectedPlanRevision: string
  preview: ImportPlanPreview
}>

export function startProviderDetailSyncSession({
  gateway,
  planId,
  getPreview,
  onPreview,
  onState,
  host,
  activeDelayMilliseconds = 2_000,
}: Readonly<{
  gateway: DataTransferSettingsGateway
  planId: string
  getPreview(): ImportPlanPreview | undefined
  onPreview(preview: ImportPlanPreview): void
  onState(state: ProviderDetailSyncState): void
  host: ProviderDetailSyncHost
  activeDelayMilliseconds?: number
}>): () => void {
  const reader = createProviderDetailPlanReader(gateway, planId)
  let polling: PollController | undefined
  let removeFocus: () => void = () => undefined
  let removeVisibility: () => void = () => undefined
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    polling?.stop()
    removeFocus()
    removeVisibility()
    reader.clear()
  }
  const currentNeedsSync = () => {
    const current = getPreview()
    return current?.planId === planId && needsProviderDetailSync(current)
  }
  polling = createPollController<ProviderDetailRead | undefined>({
    async read(signal) {
      const current = getPreview()
      if (current === undefined || current.planId !== planId) return undefined
      return {
        expectedPlanRevision: current.planRevision,
        preview: await reader.read(signal),
      }
    },
    isActive: currentNeedsSync,
    isTerminalError: terminal,
    onValue(result) {
      if (result === undefined) {
        onState({ kind: 'idle' })
        stop()
        return
      }
      const current = getPreview()
      if (current?.planId === planId &&
        current.planRevision === result.expectedPlanRevision) {
        onPreview(result.preview)
      }
      if (currentNeedsSync()) onState({ kind: 'checking' })
      else {
        onState({ kind: 'idle' })
        stop()
      }
    },
    onTerminalError(error) {
      onState({ kind: 'error', message: message(error, false) })
      stop()
    },
    onTransientError: (error) => onState({ kind: 'error', message: message(error, true) }),
    activeDelayMilliseconds,
    maximumBackoffMilliseconds: 16_000,
  })
  const wake = () => currentNeedsSync() ? polling?.trigger() : stop()
  const visibility = () => {
    if (!currentNeedsSync()) stop()
    else if (host.isHidden()) polling?.pause()
    else polling?.resume()
  }
  removeFocus = host.onFocus(wake)
  removeVisibility = host.onVisibilityChange(visibility)
  onState({ kind: 'checking' })
  if (host.isHidden()) polling.pause()
  else polling.start(false)
  return stop
}

function browserHost(): ProviderDetailSyncHost {
  return {
    isHidden: () => document.visibilityState === 'hidden',
    onFocus(listener) {
      window.addEventListener('focus', listener)
      return () => window.removeEventListener('focus', listener)
    },
    onVisibilityChange(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export function useProviderDetailSync({
  active,
  gateway,
  preview,
  getPreview,
  onPreview,
}: ProviderDetailSyncInput): ProviderDetailSyncState {
  const [state, setState] = useState<ProviderDetailSyncState>({ kind: 'idle' })
  const shouldSync = active && needsProviderDetailSync(preview)

  useEffect(() => {
    if (!shouldSync || preview === undefined) {
      setState({ kind: 'idle' })
      return
    }
    return startProviderDetailSyncSession({
      gateway,
      planId: preview.planId,
      getPreview,
      onPreview,
      onState: setState,
      host: browserHost(),
    })
  }, [gateway, getPreview, onPreview, preview?.planId, shouldSync])

  return state
}
