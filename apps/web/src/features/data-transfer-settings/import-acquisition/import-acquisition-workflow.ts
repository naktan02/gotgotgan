'use client'

import type { ImportAcquisitionV1 } from '@place/contracts/transfers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createPollController } from '../../../shared/async/poll-controller'
import type { SourceSnapshot } from '../data-transfer-settings-model'
import type {
  ImportAcquisition,
  ImportAcquisitionGateway,
} from './import-acquisition-model'

const maximumLinkCount = 20
const acquisitionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const acquisitionStorageKeys = {
  'shared-links': 'place.import-acquisition.shared.v1',
  'remote-browser': 'place.import-acquisition.remote.v1',
} as const

function rememberAcquisition(acquisition: ImportAcquisitionV1): void {
  try { window.sessionStorage.setItem(acquisitionStorageKeys[acquisition.method], acquisition.acquisitionId) } catch { /* optional recovery only */ }
}

function forgetAcquisition(method: ImportAcquisitionV1['method']): void {
  try { window.sessionStorage.removeItem(acquisitionStorageKeys[method]) } catch { /* optional recovery only */ }
}

type PendingSharedCommand = Readonly<{
  key: string
  commandId: string
  acquisitionId: string
  importSourceId: string
  snapshotId: string
  links: readonly Readonly<{ entryId: string; position: number; url: string }>[]
}>

type PendingRemoteCommand = Readonly<{
  commandId: string
  acquisitionId: string
  importSourceId: string
}>

export function sharedLinkLines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function importAcquisitionFailureMessage(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status) : 0
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') : ''
  if (status === 401) return '곳곳간 로그인이 필요합니다.'
  if (status === 413) return '한 번에 확인할 수 있는 링크 수나 응답 크기를 넘었습니다.'
  if (status === 422 && code === 'not-cancellable') return '이미 목록 확인이 시작되어 취소할 수 없습니다. 최신 상태를 다시 불러왔습니다.'
  if (status === 429 && code === 'limit-exceeded') return '가져오기 대기열이 가득 찼습니다. 진행 중인 작업이 끝나거나 대기 중인 작업을 취소한 뒤 다시 시도해 주세요.'
  if (status === 429) return 'NAVER 요청이 잠시 제한되었습니다. 잠시 후 같은 요청을 다시 시도해 주세요.'
  return '가져오기 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function useImportAcquisition(
  gateway: ImportAcquisitionGateway,
  onSnapshot: (snapshot: SourceSnapshot, selectedSourceListIds: ReadonlySet<string>) => void,
) {
  const [draft, setDraft] = useState('')
  const [shared, setShared] = useState<ImportAcquisition>()
  const [remote, setRemote] = useState<ImportAcquisition>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'shared' | 'remote' | 'snapshot' | 'cancel' | undefined>()
  const [error, setError] = useState<string>()
  const inputLabels = useRef<Map<string, string>>(new Map())
  const sharedCommand = useRef<PendingSharedCommand | undefined>(undefined)
  const remoteCommand = useRef<PendingRemoteCommand | undefined>(undefined)
  const cancelCommand = useRef<Readonly<{ key: string; commandId: string }> | undefined>(undefined)
  const recoveryController = useRef<AbortController | undefined>(undefined)
  const recoveryGeneration = useRef(0)

  const applyAcquisition = useCallback((wire: ImportAcquisitionV1) => {
    const next: ImportAcquisition = {
      ...wire,
      items: wire.items.map((item) => ({
        ...item,
        inputLabel: inputLabels.current.get(item.entryId) ?? item.name ?? `링크 ${item.position + 1}`,
      })),
    }
    if (next.method === 'shared-links') setShared(next)
    else setRemote(next)
    rememberAcquisition(wire)
    setSelected((current) => {
      const reported = new Set(next.items.map((item) => item.entryId))
      const ready = new Set(next.items.filter((item) => item.state === 'ready').map((item) => item.entryId))
      const kept = [...current].filter((entryId) => !reported.has(entryId) || ready.has(entryId))
      for (const entryId of ready) if (!current.has(entryId)) kept.push(entryId)
      return new Set(kept)
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const generation = recoveryGeneration.current + 1
    recoveryGeneration.current = generation
    recoveryController.current = controller
    const recover = async (method: ImportAcquisitionV1['method']) => {
      let acquisitionId: string | null = null
      try { acquisitionId = window.sessionStorage.getItem(acquisitionStorageKeys[method]) } catch { return }
      if (acquisitionId === null) return
      if (!acquisitionIdPattern.test(acquisitionId)) {
        forgetAcquisition(method)
        return
      }
      try {
        const acquisition = await gateway.readImportAcquisition(acquisitionId, controller.signal)
        if (controller.signal.aborted || recoveryGeneration.current !== generation) return
        if (acquisition.method !== method) {
          forgetAcquisition(method)
          return
        }
        applyAcquisition(acquisition)
      } catch (cause) {
        if (controller.signal.aborted || recoveryGeneration.current !== generation) return
        const status = typeof cause === 'object' && cause !== null && 'status' in cause
          ? Number((cause as { status?: unknown }).status) : 0
        if (status === 404) forgetAcquisition(method)
      }
    }
    void Promise.all([recover('shared-links'), recover('remote-browser')])
    return () => {
      controller.abort()
      if (recoveryController.current === controller) recoveryController.current = undefined
    }
  }, [applyAcquisition, gateway])

  const supersedeRecovery = useCallback(() => {
    recoveryGeneration.current += 1
    recoveryController.current?.abort()
    recoveryController.current = undefined
  }, [])

  useEffect(() => {
    const active = [shared, remote].filter((item): item is ImportAcquisition => item?.state === 'processing')
    if (active.length === 0) return
    const polling = createPollController<readonly ImportAcquisitionV1[]>({
      read: (signal) => Promise.all(active.map((item) =>
        gateway.readImportAcquisition(item.acquisitionId, signal))),
      isActive: (items) => items.some((item) => item.state === 'processing'),
      onValue: (items) => {
        setError(undefined)
        for (const item of items) applyAcquisition(item)
      },
      onTransientError: () => setError('진행 상태를 새로 확인하지 못했습니다. 자동으로 다시 확인합니다.'),
      activeDelayMilliseconds: 1_200,
      maximumBackoffMilliseconds: 9_600,
    })
    const handleVisibility = () => document.visibilityState === 'hidden'
      ? polling.pause()
      : polling.resume()
    if (document.visibilityState === 'hidden') polling.pause()
    else polling.start(false)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', polling.trigger)
    return () => {
      polling.stop()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', polling.trigger)
    }
  }, [applyAcquisition, gateway, remote, shared])

  const links = useMemo(() => sharedLinkLines(draft), [draft])
  const visibleSharedItems = useMemo(() => shared?.items.filter((item) => !dismissed.has(item.entryId)) ?? [], [dismissed, shared])

  const startShared = useCallback(async () => {
    if (links.length === 0) {
      setError('NAVER 공유 링크를 한 줄에 하나씩 입력해 주세요.')
      return
    }
    if (links.length > maximumLinkCount) {
      setError(`한 번에 최대 ${maximumLinkCount}개 링크를 확인할 수 있습니다.`)
      return
    }
    supersedeRecovery()
    const key = links.join('\n')
    if (sharedCommand.current?.key !== key) {
      const structuredLinks = links.map((url, position) => ({ entryId: crypto.randomUUID(), position, url }))
      sharedCommand.current = {
        key,
        commandId: crypto.randomUUID(),
        acquisitionId: crypto.randomUUID(),
        importSourceId: crypto.randomUUID(),
        snapshotId: crypto.randomUUID(),
        links: structuredLinks,
      }
      for (const link of structuredLinks) inputLabels.current.set(link.entryId, link.url)
    }
    setBusy('shared')
    setError(undefined)
    setDismissed(new Set())
    try {
      const pending = sharedCommand.current
      const next = await gateway.startSharedLinkImport({
        commandId: pending.commandId,
        acquisitionId: pending.acquisitionId,
        importSourceId: pending.importSourceId,
        snapshotId: pending.snapshotId,
        providerKey: 'naver',
        links: pending.links,
      })
      applyAcquisition(next)
      sharedCommand.current = undefined
    } catch (cause) {
      setError(importAcquisitionFailureMessage(cause))
    } finally {
      setBusy(undefined)
    }
  }, [applyAcquisition, gateway, links, supersedeRecovery])

  const startRemote = useCallback(async () => {
    supersedeRecovery()
    remoteCommand.current ??= {
      commandId: crypto.randomUUID(),
      acquisitionId: crypto.randomUUID(),
      importSourceId: crypto.randomUUID(),
    }
    setBusy('remote')
    setError(undefined)
    try {
      const next = await gateway.startRemoteImport({ ...remoteCommand.current, providerKey: 'naver' })
      applyAcquisition(next)
      remoteCommand.current = undefined
    } catch (cause) {
      setError(importAcquisitionFailureMessage(cause))
    } finally {
      setBusy(undefined)
    }
  }, [applyAcquisition, gateway, supersedeRecovery])

  const refresh = useCallback(async (acquisition: ImportAcquisition) => {
    setError(undefined)
    try {
      applyAcquisition(await gateway.readImportAcquisition(acquisition.acquisitionId))
    } catch (cause) {
      setError(importAcquisitionFailureMessage(cause))
    }
  }, [applyAcquisition, gateway])

  const reviewSnapshot = useCallback(async (acquisition: ImportAcquisition) => {
    const selectedSourceListIds = new Set(acquisition.items
      .filter((item) => item.state === 'ready' && selected.has(item.entryId) && item.sourceListId !== undefined)
      .map((item) => item.sourceListId as string))
    if (selectedSourceListIds.size === 0) {
      setError('검토할 준비가 된 목록을 하나 이상 선택해 주세요.')
      return
    }
    if (acquisition.snapshot === undefined) {
      setError('목록 스냅샷 준비가 끝난 뒤 다시 확인해 주세요.')
      return
    }
    setBusy('snapshot')
    setError(undefined)
    try {
      const snapshot = await gateway.readSourceSnapshot(acquisition.snapshot.snapshotId)
      if (snapshot.snapshotRevision !== acquisition.snapshot.snapshotVersion) {
        setError('목록 스냅샷이 갱신되었습니다. 링크 상태를 다시 확인해 주세요.')
        return
      }
      onSnapshot(snapshot, selectedSourceListIds)
    } catch (cause) {
      setError(importAcquisitionFailureMessage(cause))
    } finally {
      setBusy(undefined)
    }
  }, [gateway, onSnapshot, selected])

  const cancel = useCallback(async (acquisition: ImportAcquisition) => {
    const key = `${acquisition.acquisitionId}:${acquisition.acquisitionRevision}`
    if (cancelCommand.current?.key !== key) cancelCommand.current = { key, commandId: crypto.randomUUID() }
    setBusy('cancel')
    setError(undefined)
    try {
      applyAcquisition(await gateway.cancelImportAcquisition({
        commandId: cancelCommand.current.commandId,
        acquisitionId: acquisition.acquisitionId,
        expectedRevision: acquisition.acquisitionRevision,
      }))
      cancelCommand.current = undefined
    } catch (cause) {
      const status = typeof cause === 'object' && cause !== null && 'status' in cause
        ? Number((cause as { status?: unknown }).status) : 0
      const code = typeof cause === 'object' && cause !== null && 'code' in cause
        ? String((cause as { code?: unknown }).code ?? '') : ''
      if (status === 422 && code === 'not-cancellable') {
        try { applyAcquisition(await gateway.readImportAcquisition(acquisition.acquisitionId)) } catch { /* the original cancellation error is more useful */ }
      }
      setError(importAcquisitionFailureMessage(cause))
    } finally {
      setBusy(undefined)
    }
  }, [applyAcquisition, gateway])

  const toggle = useCallback((entryId: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(entryId)) next.delete(entryId)
    else next.add(entryId)
    return next
  }), [])

  const dismiss = useCallback((entryId: string) => {
    setDismissed((current) => new Set([...current, entryId]))
    setSelected((current) => {
      const next = new Set(current)
      next.delete(entryId)
      return next
    })
  }, [])

  return {
    draft, setDraft, links, shared, remote, visibleSharedItems,
    selected, busy, error, maximumLinkCount,
    startShared, startRemote, refresh, reviewSnapshot, cancel, toggle, dismiss,
  }
}

export type ImportAcquisitionWorkflow = ReturnType<typeof useImportAcquisition>
