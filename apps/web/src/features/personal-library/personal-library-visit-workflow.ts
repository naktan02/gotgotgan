'use client'

import type { BrowserVisitRecordRequest } from '@place/contracts/http'
import type { PlaceDetailResponse } from '@place/contracts/places'
import type { VisitHistoryResponse } from '@place/contracts/visits'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserVisitProblem,
  personalLibraryVisitsHttp,
} from './personal-library-visits-http'

type VisitSummary = NonNullable<PlaceDetailResponse['personalState']>['visits']
type HistoryLoad = Readonly<{
  placeId: string
  cursor?: string
  append: boolean
}>

type VisitWorkflowInput = Readonly<{
  active: boolean
  selectedPlaceId?: string
  summary?: VisitSummary
  onAccessFailure: (reason: unknown) => void
  refreshPlace: () => Promise<unknown>
}>

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toVisitTime(value: string): string | undefined {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp <= Date.now()
    ? new Date(timestamp).toISOString()
    : undefined
}

export function usePersonalLibraryVisitWorkflow(input: VisitWorkflowInput) {
  const [items, setItems] = useState<VisitHistoryResponse['items']>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [visitedAtLocal, setVisitedAtLocal] = useState('')
  const [maxVisitedAtLocal, setMaxVisitedAtLocal] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [failedRecord, setFailedRecord] = useState<BrowserVisitRecordRequest | undefined>()
  const [failedHistory, setFailedHistory] = useState<HistoryLoad | undefined>()
  const requestSequence = useRef(0)
  const mutationRef = useRef(false)
  const selectedPlaceRef = useRef(input.selectedPlaceId)
  selectedPlaceRef.current = input.selectedPlaceId

  const loadHistory = useCallback(async (
    placeId: string,
    cursor?: string,
    append = false,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    setFailedHistory(undefined)
    if (!append) {
      setItems([])
      setNextCursor(undefined)
    }
    try {
      const page = await personalLibraryVisitsHttp.history(placeId, cursor, signal)
      if (sequence !== requestSequence.current || selectedPlaceRef.current !== placeId) return
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
    } catch (reason) {
      if (
        sequence !== requestSequence.current || selectedPlaceRef.current !== placeId ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (reason instanceof BrowserVisitProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else {
        setFailedHistory({ placeId, ...(cursor === undefined ? {} : { cursor }), append })
        setError('방문 이력을 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [input.onAccessFailure])

  useEffect(() => {
    requestSequence.current += 1
    setItems([])
    setNextCursor(undefined)
    setError(undefined)
    setNotice(undefined)
    setFailedRecord(undefined)
    setFailedHistory(undefined)
    const now = localDateTimeValue(new Date())
    setVisitedAtLocal(now)
    setMaxVisitedAtLocal(now)
    if (!input.active || input.selectedPlaceId === undefined) return
    const controller = new AbortController()
    void loadHistory(input.selectedPlaceId, undefined, false, controller.signal)
    return () => controller.abort()
  }, [input.active, input.selectedPlaceId, loadHistory])

  const executeRecord = useCallback(async (request: BrowserVisitRecordRequest) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setRecording(true)
    setError(undefined)
    setNotice(undefined)
    setFailedRecord(undefined)
    try {
      await personalLibraryVisitsHttp.record(request)
      if (selectedPlaceRef.current !== request.placeId) return
      await Promise.all([
        loadHistory(request.placeId),
        input.refreshPlace(),
      ])
      const now = localDateTimeValue(new Date())
      setVisitedAtLocal(now)
      setMaxVisitedAtLocal(now)
      setNotice('방문 기록을 추가했습니다.')
    } catch (reason) {
      if (selectedPlaceRef.current !== request.placeId) return
      if (reason instanceof BrowserVisitProblem && [401, 403].includes(reason.status)) {
        input.onAccessFailure(reason)
      } else if (reason instanceof BrowserVisitProblem && reason.status === 400) {
        setError('방문 시각을 확인해 주세요. 미래 시각은 기록할 수 없습니다.')
      } else if (reason instanceof BrowserVisitProblem && reason.status === 409) {
        setError('기존 방문 기록과 충돌했습니다. 새 기록으로 다시 시도해 주세요.')
      } else {
        setFailedRecord(request)
        setError('방문 기록 결과를 확인하지 못했습니다.')
      }
    } finally {
      mutationRef.current = false
      setRecording(false)
    }
  }, [input.onAccessFailure, input.refreshPlace, loadHistory])

  const visitedAt = toVisitTime(visitedAtLocal)

  return {
    visits: {
      summary: input.summary,
      items,
      nextCursor,
      visitedAtLocal,
      maxVisitedAtLocal,
      loading,
      loadingMore,
      recording,
      error,
      notice,
      recordValid: input.selectedPlaceId !== undefined && visitedAt !== undefined,
      canRetryRecord: failedRecord !== undefined,
      canRetryHistory: failedHistory !== undefined,
      setVisitedAtLocal,
      record: () => input.selectedPlaceId === undefined || visitedAt === undefined
        ? Promise.resolve()
        : executeRecord({
            id: crypto.randomUUID(),
            placeId: input.selectedPlaceId,
            visitedAt,
          }),
      retryRecord: () => failedRecord === undefined ? undefined : executeRecord(failedRecord),
      retryHistory: () => failedHistory === undefined
        ? undefined
        : loadHistory(failedHistory.placeId, failedHistory.cursor, failedHistory.append),
      loadMore: () => input.selectedPlaceId === undefined || nextCursor === undefined
        ? undefined
        : loadHistory(input.selectedPlaceId, nextCursor, true),
    },
  }
}

export type PersonalLibraryVisits = ReturnType<typeof usePersonalLibraryVisitWorkflow>['visits']
