'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  OperationAction,
  OperationDetail,
  OperationFilters,
  OperationHistoryGateway,
  OperationHistoryPage,
  OperationItemReceipt,
  OperationItemPage,
  OperationSummary,
} from './operation-history-model'
import { OperationHistoryProblem } from './operation-history-model'
import { createOperationPollController, type OperationPollController } from './operation-polling'

export type OperationLoadState =
  | 'loading'
  | 'ready'
  | 'authentication-required'
  | 'forbidden'
  | 'not-found'
  | 'unavailable'

type ActionState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'working'; action: OperationAction }>
  | Readonly<{ kind: 'error'; message: string }>

function loadState(error: unknown): OperationLoadState {
  if (!(error instanceof OperationHistoryProblem)) return 'unavailable'
  if (error.status === 401) return 'authentication-required'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  return 'unavailable'
}

function actionError(error: unknown): string {
  if (!(error instanceof OperationHistoryProblem)) return '작업 요청을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  if (error.status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  if (error.status === 403) return '이 작업을 변경할 권한이 없습니다.'
  if (error.status === 404) return '작업이 더 이상 존재하지 않습니다.'
  if (error.status === 409) return '다른 처리로 상태가 변경되었습니다. 최신 상태를 다시 불러왔습니다.'
  if (error.status === 422) return '현재 단계에서는 이 작업을 실행할 수 없습니다.'
  return '작업 서비스가 일시적으로 응답하지 않습니다.'
}

const activeStates = new Set<OperationSummary['state']>(['queued', 'running', 'retry-scheduled'])

function matchesFilters(operation: OperationSummary, filters: OperationFilters): boolean {
  return (filters.kind === '' || filters.kind === operation.kind)
    && (filters.state === '' || filters.state === operation.state)
}

type PolledProjection = Readonly<{
  page: OperationHistoryPage
  selectionAtStart?: string
  selectedId?: string
  detail?: OperationDetail
  itemPage?: OperationItemPage
}>

export function signalOperationProjectionChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('place:operation-projection-changed'))
}

export function useOperationHistory(gateway: OperationHistoryGateway) {
  const [filters, setFilters] = useState<OperationFilters>({ kind: '', state: '' })
  const [operations, setOperations] = useState<readonly OperationSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<OperationDetail>()
  const [receipts, setReceipts] = useState<readonly OperationItemReceipt[]>([])
  const [nextItemCursor, setNextItemCursor] = useState<string>()
  const [listState, setListState] = useState<OperationLoadState>('loading')
  const [detailState, setDetailState] = useState<OperationLoadState>('loading')
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle' })
  const [confirmingAction, setConfirmingAction] = useState<OperationAction>()
  const listSequence = useRef(0)
  const itemSequence = useRef(0)
  const listAbort = useRef<AbortController | undefined>(undefined)
  const detailAbort = useRef<AbortController | undefined>(undefined)
  const selectedIdRef = useRef<string | undefined>(undefined)
  const pollingRef = useRef<OperationPollController | undefined>(undefined)

  const setSelection = useCallback((operationId?: string) => {
    selectedIdRef.current = operationId
    setSelectedId(operationId)
  }, [])

  const loadList = useCallback(async (cursor?: string) => {
    const sequence = ++listSequence.current
    listAbort.current?.abort()
    const controller = new AbortController()
    listAbort.current = controller
    if (cursor === undefined) setListState('loading')
    try {
      const page = await gateway.list(filters, cursor, controller.signal)
      if (sequence !== listSequence.current) return
      setOperations((current) => cursor === undefined ? page.items : [...current, ...page.items])
      setNextCursor(page.nextCursor)
      setListState('ready')
      if (cursor === undefined) {
        const current = selectedIdRef.current
        setSelection(page.items.some((item) => item.operationId === current) ? current : page.items[0]?.operationId)
      }
    } catch (error) {
      if (sequence !== listSequence.current) return
      setListState(loadState(error))
      if (cursor === undefined) {
        setOperations([])
        setSelection(undefined)
      }
    }
  }, [filters, gateway, setSelection])

  useEffect(() => {
    void loadList()
    return () => {
      listAbort.current?.abort()
      listSequence.current += 1
    }
  }, [loadList])

  const loadDetail = useCallback(async (operationId: string) => {
    const sequence = ++itemSequence.current
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    setDetailState('loading')
    try {
      const [nextDetail, itemPage] = await Promise.all([
        gateway.detail(operationId, controller.signal), gateway.items(operationId, undefined, controller.signal),
      ])
      if (sequence !== itemSequence.current) return
      setDetail(nextDetail)
      setReceipts(itemPage.items)
      setNextItemCursor(itemPage.nextCursor)
      setDetailState('ready')
    } catch (error) {
      if (sequence !== itemSequence.current) return
      setDetail(undefined)
      setReceipts([])
      setNextItemCursor(undefined)
      setDetailState(loadState(error))
    }
  }, [gateway])

  useEffect(() => {
    if (selectedId !== undefined) void loadDetail(selectedId)
    else {
      setDetail(undefined)
      setReceipts([])
    }
    return () => {
      detailAbort.current?.abort()
      itemSequence.current += 1
    }
  }, [loadDetail, selectedId])

  const hasActiveOperations = listState === 'ready' && operations.some((operation) => activeStates.has(operation.state))

  useEffect(() => {
    if (!hasActiveOperations) return
    const readSelection = async (operationId: string, signal: AbortSignal) => {
      const [nextDetail, itemPage] = await Promise.all([
        gateway.detail(operationId, signal), gateway.items(operationId, undefined, signal),
      ])
      return { nextDetail, itemPage }
    }
    const polling = createOperationPollController<PolledProjection>({
      async read(signal) {
        const selectionAtStart = selectedIdRef.current
        const page = await gateway.list(filters, undefined, signal)
        let nextSelectedId = selectionAtStart ?? page.items[0]?.operationId
        let selection = nextSelectedId === undefined ? undefined : await readSelection(nextSelectedId, signal).catch((error) => {
          if (error instanceof OperationHistoryProblem && error.status === 404) return undefined
          throw error
        })
        if (selection !== undefined && !matchesFilters(selection.nextDetail, filters)) {
          nextSelectedId = page.items[0]?.operationId
          selection = nextSelectedId === undefined || nextSelectedId === selectionAtStart
            ? undefined
            : await readSelection(nextSelectedId, signal)
        } else if (selection === undefined && nextSelectedId !== page.items[0]?.operationId) {
          nextSelectedId = page.items[0]?.operationId
          selection = nextSelectedId === undefined ? undefined : await readSelection(nextSelectedId, signal)
        }
        return {
          page,
          ...(selectionAtStart === undefined ? {} : { selectionAtStart }),
          ...(nextSelectedId === undefined ? {} : { selectedId: nextSelectedId }),
          ...(selection === undefined ? {} : { detail: selection.nextDetail, itemPage: selection.itemPage }),
        }
      },
      isActive: (projection) => projection.page.items.some((operation) => activeStates.has(operation.state)),
      onValue(projection) {
        setOperations(projection.page.items)
        setNextCursor(projection.page.nextCursor)
        setListState('ready')
        if (selectedIdRef.current !== projection.selectionAtStart) return
        setSelection(projection.selectedId)
        setDetail(projection.detail)
        setReceipts(projection.itemPage?.items ?? [])
        setNextItemCursor(projection.itemPage?.nextCursor)
        setDetailState(projection.selectedId === undefined ? 'loading' : projection.detail === undefined ? 'not-found' : 'ready')
      },
      onTerminalError(error) {
        const state = loadState(error)
        setListState(state)
        setDetailState(state)
      },
    })
    const refresh = () => polling.trigger()
    const handleVisibility = () => document.visibilityState === 'hidden' ? polling.pause() : polling.resume()
    pollingRef.current = polling
    if (document.visibilityState === 'hidden') polling.pause()
    else polling.start(false)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (pollingRef.current === polling) pollingRef.current = undefined
      polling.stop()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [filters, gateway, hasActiveOperations, setSelection])

  const loadMoreItems = async () => {
    if (selectedId === undefined || nextItemCursor === undefined) return
    const sequence = ++itemSequence.current
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    try {
      const page = await gateway.items(selectedId, nextItemCursor, controller.signal)
      if (sequence !== itemSequence.current) return
      setReceipts((current) => [...current, ...page.items])
      setNextItemCursor(page.nextCursor)
    } catch (error) {
      if (sequence === itemSequence.current) setActionState({ kind: 'error', message: actionError(error) })
    }
  }

  const runAction = async (action: OperationAction) => {
    if (detail === undefined || !detail.allowedActions.includes(action)) return
    const polling = pollingRef.current
    polling?.pause()
    setConfirmingAction(undefined)
    setActionState({ kind: 'working', action })
    try {
      await gateway.command({
        commandId: crypto.randomUUID(),
        operationId: detail.operationId,
        expectedOperationRevision: detail.operationRevision,
        action,
      })
      signalOperationProjectionChanged()
      setActionState({ kind: 'idle' })
      if (polling !== undefined) polling.resume()
      else await Promise.all([loadList(), loadDetail(detail.operationId)])
    } catch (error) {
      setActionState({ kind: 'error', message: actionError(error) })
      if (polling !== undefined) polling.resume()
      else if (error instanceof OperationHistoryProblem && error.status === 409) {
        await Promise.all([loadList(), loadDetail(detail.operationId)])
      }
    }
  }

  return {
    filters,
    setFilters,
    operations,
    nextCursor,
    selectedId,
    select: setSelection,
    detail,
    receipts,
    nextItemCursor,
    listState,
    detailState,
    actionState,
    confirmingAction,
    requestAction(action: OperationAction) {
      if (action === 'cancel') setConfirmingAction(action)
      else void runAction(action)
    },
    confirmAction: () => confirmingAction === undefined ? undefined : void runAction(confirmingAction),
    dismissConfirmation: () => setConfirmingAction(undefined),
    loadMore: () => void loadList(nextCursor),
    loadMoreItems: () => void loadMoreItems(),
    retry() {
      if (pollingRef.current !== undefined) {
        pollingRef.current.trigger()
        return
      }
      void loadList()
      if (selectedIdRef.current !== undefined) void loadDetail(selectedIdRef.current)
    },
    reloadDetail: () => selectedId === undefined ? undefined : void loadDetail(selectedId),
  }
}

export type OperationHistoryWorkflow = ReturnType<typeof useOperationHistory>
