'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  DataTransferSettingsGateway,
  DataTransferSettingsOverview,
  ImportMapping,
  ImportPlanPreview,
  OutboundTransferPreview,
  ProviderConnection,
  ProviderTargetListProjection,
  SettingsTab,
  SourceSnapshot,
  TransferOperationReceipt,
  TransferProviderKey,
} from './data-transfer-settings-model'
import { DataTransferSettingsProblem } from './data-transfer-settings-model'

type LoadState = 'loading' | 'ready' | 'authentication-required' | 'forbidden' | 'unavailable'
type ActionState = Readonly<{ kind: 'idle' | 'working' | 'done' }> | Readonly<{ kind: 'error'; message: string }>

const validTabs = new Set<SettingsTab>(['account', 'connections', 'import', 'export', 'history', 'profile'])

function failureMessage(error: unknown, fallback: string): string {
  if (!(error instanceof DataTransferSettingsProblem)) return fallback
  if (error.status === 401) return '로그인이 필요합니다.'
  if (error.status === 403) return '이 작업을 수행할 권한이 없습니다.'
  if (error.status === 404) return '대상이 삭제되었거나 연결이 해제되었습니다.'
  if (error.status === 409) return '확인 이후 데이터가 변경되었습니다. 최신 내용을 다시 검토해 주세요.'
  if (error.status === 422) return '선택한 항목 중 처리할 수 없는 내용이 있습니다.'
  return fallback
}

export function normalizeSettingsTab(value: string | undefined): SettingsTab {
  return value !== undefined && validTabs.has(value as SettingsTab) ? value as SettingsTab : 'connections'
}

export function useDataTransferSettings(
  gateway: DataTransferSettingsGateway,
  initialTab: SettingsTab = 'connections',
) {
  const [tab, setTabState] = useState(initialTab)
  const [overview, setOverview] = useState<DataTransferSettingsOverview>()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [providerActions, setProviderActions] = useState<Partial<Record<TransferProviderKey, ActionState>>>({})
  const [providerOperations, setProviderOperations] = useState<Partial<Record<TransferProviderKey, Readonly<{
    kind: 'import' | 'export'; receipt: TransferOperationReceipt
  }>>>>({})

  const [importProvider, setImportProvider] = useState<TransferProviderKey>('naver')
  const [importConnectionId, setImportConnectionId] = useState('')
  const [snapshot, setSnapshot] = useState<SourceSnapshot>()
  const [mappings, setMappings] = useState<ImportMapping[]>([])
  const [importPreview, setImportPreview] = useState<ImportPlanPreview>()
  const [importState, setImportState] = useState<ActionState>({ kind: 'idle' })
  const [importApproval, setImportApproval] = useState<ActionState>({ kind: 'idle' })
  const [importDecisions, setImportDecisions] = useState<Record<string, ActionState>>({})

  const [exportProvider, setExportProvider] = useState<TransferProviderKey>('naver')
  const [exportConnectionId, setExportConnectionId] = useState('')
  const [exportCollectionId, setExportCollectionId] = useState('')
  const [exportCollectionState, setExportCollectionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [exportSelectionKind, setExportSelectionKind] = useState<'all' | 'places'>('all')
  const [exportPlaceIds, setExportPlaceIds] = useState<Set<string>>(new Set())
  const [targetKind, setTargetKind] = useState<'new' | 'existing'>('new')
  const [targetListName, setTargetListName] = useState('')
  const [targetListId, setTargetListId] = useState('')
  const [exportPreview, setExportPreview] = useState<OutboundTransferPreview>()
  const [exportState, setExportState] = useState<ActionState>({ kind: 'idle' })
  const [exportApproval, setExportApproval] = useState<ActionState>({ kind: 'idle' })
  const [targetLists, setTargetLists] = useState<ProviderTargetListProjection>()
  const [targetListState, setTargetListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const overviewRequest = useRef(0)
  const overviewAbort = useRef<AbortController | undefined>(undefined)
  const collectionRequest = useRef(0)
  const collectionAbort = useRef<AbortController | undefined>(undefined)
  const connectionCommands = useRef(new Map<string, string>())
  const snapshotCommand = useRef<string | undefined>(undefined)
  const importPreviewCommand = useRef<string | undefined>(undefined)
  const importApprovalCommand = useRef<string | undefined>(undefined)
  const importDecisionCommands = useRef(new Map<string, string>())
  const exportPreviewCommand = useRef<string | undefined>(undefined)
  const exportApprovalCommand = useRef<string | undefined>(undefined)
  const targetListRequest = useRef(0)
  const targetListAbort = useRef<AbortController | undefined>(undefined)

  const load = useCallback(async () => {
    const sequence = ++overviewRequest.current
    overviewAbort.current?.abort()
    const controller = new AbortController()
    overviewAbort.current = controller
    setLoadState('loading')
    try {
      const next = await gateway.overview(controller.signal)
      if (sequence !== overviewRequest.current) return
      setOverview(next)
      setLoadState('ready')
      setExportCollectionId((current) => current || next.collections[0]?.collectionId || '')
      setTargetListName((current) => current || next.collections[0]?.name || '')
    } catch (error) {
      if (sequence !== overviewRequest.current || controller.signal.aborted) return
      setLoadState(error instanceof DataTransferSettingsProblem && error.status === 401
        ? 'authentication-required'
        : error instanceof DataTransferSettingsProblem && error.status === 403
          ? 'forbidden' : 'unavailable')
    }
  }, [gateway])

  useEffect(() => { void load(); return () => overviewAbort.current?.abort() }, [load])

  const setTab = useCallback((next: SettingsTab) => {
    setTabState(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url)
  }, [])

  const provider = useCallback((key: TransferProviderKey) => (
    overview?.providers.find((item) => item.capability.providerKey === key)
  ), [overview])

  useEffect(() => {
    const connections = provider(importProvider)?.connections ?? []
    setImportConnectionId((current) => connections.some((item) => item.connectionId === current && item.state === 'ready')
      ? current : (connections.find((item) => item.state === 'ready')?.connectionId ?? ''))
  }, [importProvider, provider])

  useEffect(() => {
    const connections = provider(exportProvider)?.connections ?? []
    setExportConnectionId((current) => connections.some((item) => item.connectionId === current && item.state === 'ready')
      ? current : (connections.find((item) => item.state === 'ready')?.connectionId ?? ''))
  }, [exportProvider, provider])

  const readyConnection = useCallback((key: TransferProviderKey, connectionId: string) => (
    provider(key)?.connections.find((connection) => (
      connection.connectionId === connectionId && connection.state === 'ready'
    ))
  ), [provider])

  const connectionCommand = useCallback(async (
    providerKey: TransferProviderKey,
    kind: 'connect' | 'reconnect' | 'disconnect',
    connection?: ProviderConnection,
  ) => {
    const key = `${providerKey}:${kind}:${connection?.connectionId ?? 'new'}:${connection?.revision ?? ''}`
    const commandId = connectionCommands.current.get(key) ?? crypto.randomUUID()
    connectionCommands.current.set(key, commandId)
    setProviderActions((current) => ({ ...current, [providerKey]: { kind: 'working' } }))
    try {
      await gateway.connectionCommand({
        commandId, kind, providerKey,
        ...(connection === undefined ? {} : {
          connectionId: connection.connectionId,
          expectedRevision: connection.revision,
        }),
      })
      connectionCommands.current.delete(key)
      setProviderActions((current) => ({ ...current, [providerKey]: { kind: 'done' } }))
      await load()
    } catch (error) {
      setProviderActions((current) => ({ ...current, [providerKey]: {
        kind: 'error', message: failureMessage(error, '연결 상태를 변경하지 못했습니다.'),
      } }))
    }
  }, [gateway, load])

  const changeImportProvider = useCallback((key: TransferProviderKey) => {
    setImportProvider(key)
    setImportConnectionId(provider(key)?.connections.find((connection) => connection.state === 'ready')?.connectionId ?? '')
    setSnapshot(undefined); setMappings([]); setImportPreview(undefined)
    setImportState({ kind: 'idle' }); setImportApproval({ kind: 'idle' }); setImportDecisions({})
    snapshotCommand.current = undefined; importPreviewCommand.current = undefined; importApprovalCommand.current = undefined
  }, [provider])

  const acquireSnapshot = useCallback(async () => {
    if (importConnectionId === '') return
    setImportState({ kind: 'working' })
    snapshotCommand.current ??= crypto.randomUUID()
    try {
      const next = await gateway.acquireSnapshot({
        commandId: snapshotCommand.current,
        providerKey: importProvider,
        connectionId: importConnectionId,
      })
      snapshotCommand.current = undefined
      setSnapshot(next)
      setMappings(next.lists.map((list) => ({
        sourceListId: list.sourceListId,
        selected: true,
        target: { kind: 'new', collectionId: crypto.randomUUID(), name: list.name },
      })))
      setImportPreview(undefined)
      setImportDecisions({})
      setImportState({ kind: 'done' })
    } catch (error) {
      setImportState({
        kind: 'error',
        message: error instanceof DataTransferSettingsProblem && error.status === 404
          ? '아직 수집된 스냅샷이 없습니다. Connector에서 즐겨찾기를 수집한 뒤 다시 불러와 주세요.'
          : failureMessage(error, '저장된 외부 목록 스냅샷을 불러오지 못했습니다.'),
      })
    }
  }, [gateway, importConnectionId, importProvider])

  const updateMapping = useCallback((sourceListId: string, update: (current: ImportMapping) => ImportMapping) => {
    setMappings((current) => current.map((mapping) => mapping.sourceListId === sourceListId ? update(mapping) : mapping))
    setImportPreview(undefined); setImportApproval({ kind: 'idle' }); importPreviewCommand.current = undefined
  }, [])

  const previewImport = useCallback(async () => {
    if (snapshot === undefined || mappings.every((mapping) => !mapping.selected)) {
      setImportState({ kind: 'error', message: '가져올 외부 목록을 하나 이상 선택해 주세요.' }); return
    }
    setImportState({ kind: 'working' })
    importPreviewCommand.current ??= crypto.randomUUID()
    try {
      const preview = await gateway.previewImport({
        commandId: importPreviewCommand.current,
        snapshotId: snapshot.snapshotId,
        expectedSnapshotRevision: snapshot.snapshotRevision,
        mappings: mappings.filter((mapping) => mapping.selected),
      })
      importPreviewCommand.current = undefined
      setImportPreview(preview)
      setImportState({ kind: 'done' })
    } catch (error) {
      setImportState({ kind: 'error', message: failureMessage(error, '가져오기 미리보기를 만들지 못했습니다.') })
    }
  }, [gateway, mappings, snapshot])

  const approveImport = useCallback(async () => {
    if (importPreview === undefined || !importPreview.approvalEligible) return
    setImportApproval({ kind: 'working' })
    importApprovalCommand.current ??= crypto.randomUUID()
    try {
      const receipt = await gateway.approveImport({
        commandId: importApprovalCommand.current,
        planId: importPreview.planId,
        expectedPlanRevision: importPreview.planRevision,
      })
      importApprovalCommand.current = undefined
      setImportApproval({ kind: 'done' })
      setProviderOperations((current) => ({ ...current, [importProvider]: { kind: 'import', receipt } }))
    } catch (error) {
      setImportApproval({ kind: 'error', message: failureMessage(error, '가져오기 승인을 처리하지 못했습니다.') })
    }
  }, [gateway, importPreview, importProvider])

  const decideImportItem = useCallback(async (
    sourceListId: string,
    sourceItemId: string,
    decision: Readonly<{ kind: 'link'; placeId: string }> | Readonly<{ kind: 'skip' }>,
  ) => {
    if (importPreview === undefined) return
    const stateKey = `${sourceListId}:${sourceItemId}`
    const commandKey = `${importPreview.planId}:${importPreview.planRevision}:${stateKey}:${decision.kind}:${decision.kind === 'link' ? decision.placeId : ''}`
    const commandId = importDecisionCommands.current.get(commandKey) ?? crypto.randomUUID()
    importDecisionCommands.current.set(commandKey, commandId)
    setImportDecisions((current) => ({ ...current, [stateKey]: { kind: 'working' } }))
    try {
      const next = await gateway.decideImportItem({
        commandId,
        planId: importPreview.planId,
        expectedPlanRevision: importPreview.planRevision,
        sourceListId,
        sourceItemId,
        decision,
      })
      importDecisionCommands.current.delete(commandKey)
      setImportPreview(next)
      setImportApproval({ kind: 'idle' })
      setImportDecisions((current) => ({ ...current, [stateKey]: { kind: 'done' } }))
    } catch (error) {
      setImportDecisions((current) => ({ ...current, [stateKey]: {
        kind: 'error', message: failureMessage(error, '장소 매칭 결정을 반영하지 못했습니다.'),
      } }))
    }
  }, [gateway, importPreview])

  const selectedExportCollection = useMemo(() => overview?.collections.find(
    (collection) => collection.collectionId === exportCollectionId,
  ), [exportCollectionId, overview])

  useEffect(() => {
    if (selectedExportCollection === undefined) {
      setExportCollectionState('idle'); return
    }
    if (selectedExportCollection.placeCount === 0 || selectedExportCollection.places.length > 0) {
      setExportCollectionState('ready'); return
    }
    const sequence = ++collectionRequest.current
    collectionAbort.current?.abort()
    const controller = new AbortController()
    collectionAbort.current = controller
    setExportCollectionState('loading')
    void gateway.collection(selectedExportCollection.collectionId, controller.signal).then((collection) => {
      if (sequence !== collectionRequest.current) return
      setOverview((current) => current === undefined ? current : {
        ...current,
        collections: current.collections.map((item) => item.collectionId === collection.collectionId ? collection : item),
      })
      setExportCollectionState('ready')
    }).catch(() => {
      if (sequence !== collectionRequest.current || controller.signal.aborted) return
      setExportCollectionState('error')
    })
    return () => controller.abort()
  }, [gateway, selectedExportCollection])

  const invalidateExport = useCallback(() => {
    setExportPreview(undefined); setExportState({ kind: 'idle' }); setExportApproval({ kind: 'idle' })
    exportPreviewCommand.current = undefined; exportApprovalCommand.current = undefined
  }, [])

  const changeExportProvider = useCallback((key: TransferProviderKey) => {
    setExportProvider(key)
    setExportConnectionId(provider(key)?.connections.find((connection) => connection.state === 'ready')?.connectionId ?? '')
    setTargetKind('new'); setTargetListId('')
    setTargetListName(selectedExportCollection?.name ?? '')
    invalidateExport()
  }, [invalidateExport, provider, selectedExportCollection])

  useEffect(() => {
    if (exportConnectionId === '') {
      setTargetLists(undefined); setTargetListState('idle'); return
    }
    const sequence = ++targetListRequest.current
    targetListAbort.current?.abort()
    const controller = new AbortController()
    targetListAbort.current = controller
    setTargetListState('loading')
    void gateway.targetLists(exportConnectionId, controller.signal).then((projection) => {
      if (sequence !== targetListRequest.current) return
      setTargetLists(projection)
      setTargetListState('ready')
      if (projection.items.length === 0 && targetKind === 'existing') setTargetKind('new')
    }).catch(() => {
      if (sequence !== targetListRequest.current || controller.signal.aborted) return
      setTargetLists(undefined); setTargetListState('error')
    })
    return () => controller.abort()
  }, [exportConnectionId, gateway, targetKind])

  const toggleExportPlace = useCallback((placeId: string) => {
    setExportPlaceIds((current) => {
      const next = new Set(current); if (next.has(placeId)) next.delete(placeId); else next.add(placeId); return next
    })
    invalidateExport()
  }, [invalidateExport])

  const previewExport = useCallback(async () => {
    const connection = readyConnection(exportProvider, exportConnectionId)
    if (selectedExportCollection === undefined || connection === undefined) {
      setExportState({ kind: 'error', message: '연결된 계정과 내 컬렉션을 선택해 주세요.' }); return
    }
    if (exportSelectionKind === 'places' && exportPlaceIds.size === 0) {
      setExportState({ kind: 'error', message: '내보낼 장소를 하나 이상 선택해 주세요.' }); return
    }
    if (targetListName.trim() === '' || (targetKind === 'existing' && targetListId.trim() === '')) {
      setExportState({ kind: 'error', message: '대상 목록을 선택하거나 새 목록 이름을 입력해 주세요.' }); return
    }
    setExportState({ kind: 'working' })
    exportPreviewCommand.current ??= crypto.randomUUID()
    try {
      const preview = await gateway.previewExport({
        commandId: exportPreviewCommand.current,
        providerKey: exportProvider,
        connectionId: connection.connectionId,
        collectionId: selectedExportCollection.collectionId,
        expectedCollectionRevision: selectedExportCollection.collectionRevision,
        selection: exportSelectionKind === 'all' ? { kind: 'all' } : {
          kind: 'places', placeIds: [...exportPlaceIds].sort(),
        },
        targetList: targetKind === 'new' ? { kind: 'new', name: targetListName.trim() } : {
          kind: 'existing', targetListId: targetListId.trim(), name: targetListName.trim(),
        },
      })
      exportPreviewCommand.current = undefined
      setExportPreview(preview)
      setExportState({ kind: 'done' })
    } catch (error) {
      setExportState({ kind: 'error', message: failureMessage(error, '내보내기 미리보기를 만들지 못했습니다.') })
    }
  }, [exportConnectionId, exportPlaceIds, exportProvider, exportSelectionKind, gateway, readyConnection, selectedExportCollection, targetKind, targetListId, targetListName])

  const approveExport = useCallback(async () => {
    if (
      exportPreview === undefined || exportPreview.state === 'blocked' ||
      !exportPreview.approvalEligible
    ) return
    setExportApproval({ kind: 'working' })
    exportApprovalCommand.current ??= crypto.randomUUID()
    try {
      const receipt = await gateway.approveExport({
        commandId: exportApprovalCommand.current,
        transferId: exportPreview.transferId,
        expectedTransferRevision: exportPreview.transferRevision,
      })
      exportApprovalCommand.current = undefined
      setExportApproval({ kind: 'done' })
      setProviderOperations((current) => ({ ...current, [exportProvider]: { kind: 'export', receipt } }))
    } catch (error) {
      setExportApproval({ kind: 'error', message: failureMessage(error, '내보내기 승인을 처리하지 못했습니다.') })
    }
  }, [exportPreview, exportProvider, gateway])

  return {
    tab, overview, loadState, providerActions, providerOperations,
    importProvider, importConnectionId, snapshot, mappings, importPreview, importState,
    importApproval, importDecisions,
    exportProvider, exportConnectionId, exportCollectionId, exportCollectionState, exportSelectionKind, exportPlaceIds,
    targetKind, targetListName, targetListId, targetLists, targetListState, exportPreview, exportState, exportApproval,
    selectedExportCollection,
    setTab, retry: load, connectionCommand,
    changeImportProvider,
    setImportConnectionId: (value: string) => {
      setImportConnectionId(value); setSnapshot(undefined); setMappings([]); setImportPreview(undefined)
      setImportState({ kind: 'idle' }); setImportApproval({ kind: 'idle' }); setImportDecisions({})
      snapshotCommand.current = undefined; importPreviewCommand.current = undefined; importApprovalCommand.current = undefined
    },
    acquireSnapshot, updateMapping, previewImport, decideImportItem, approveImport,
    changeExportProvider,
    setExportConnectionId: (value: string) => {
      setExportConnectionId(value); setTargetKind('new'); setTargetListId('')
      setTargetListName(selectedExportCollection?.name ?? '')
      invalidateExport()
    },
    setExportCollectionId: (value: string) => { setExportCollectionId(value); setExportCollectionState('loading'); setExportPlaceIds(new Set()); setTargetListName(overview?.collections.find((item) => item.collectionId === value)?.name ?? ''); invalidateExport() },
    setExportSelectionKind: (value: 'all' | 'places') => { setExportSelectionKind(value); invalidateExport() },
    toggleExportPlace,
    setTargetKind: (value: 'new' | 'existing') => { setTargetKind(value); invalidateExport() },
    setTargetListName: (value: string) => { setTargetListName(value); invalidateExport() },
    setTargetListId: (value: string) => {
      setTargetListId(value)
      setTargetListName(targetLists?.items.find((item) => item.targetListId === value)?.name ?? '')
      invalidateExport()
    },
    previewExport, approveExport,
  }
}

export type DataTransferSettingsWorkflow = ReturnType<typeof useDataTransferSettings>
