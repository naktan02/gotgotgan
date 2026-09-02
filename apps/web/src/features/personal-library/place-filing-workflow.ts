'use client'

import type {
  PlaceFilingCommandRequestV2,
  PlaceFilingResponseV2,
} from '@place/contracts/library'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  CollectionLibraryProblem,
  collectionLibraryHttp,
} from './collection-library-http'

type FilingMessage = Readonly<{
  tone: 'info' | 'success' | 'warning' | 'error'
  text: string
}>

export function usePlaceFilingWorkflow(
  placeId: string | undefined,
  onApplied: () => Promise<unknown>,
  onAccessFailure: (status: number) => void,
) {
  const [filing, setFiling] = useState<PlaceFilingResponseV2 | undefined>()
  const [desired, setDesired] = useState<Readonly<Record<string, boolean>>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<FilingMessage | undefined>()
  const [retryRequest, setRetryRequest] = useState<PlaceFilingCommandRequestV2 | undefined>()
  const desiredRef = useRef(desired)
  desiredRef.current = desired

  const load = useCallback(async (
    nextPlaceId: string,
    cursor?: string,
    append = false,
    preserveDraft = false,
    signal?: AbortSignal,
  ) => {
    append ? setLoadingMore(true) : setLoading(true)
    try {
      const page = await collectionLibraryHttp.filing(nextPlaceId, cursor, signal)
      setFiling((current) => append && current !== undefined ? {
        ...page,
        collections: [...current.collections, ...page.collections],
      } : page)
      setDesired((current) => {
        const base = append ? current : {}
        return Object.fromEntries([
          ...Object.entries(base),
          ...page.collections.map((collection) => [
            collection.collectionId,
            preserveDraft && collection.collectionId in desiredRef.current
              ? desiredRef.current[collection.collectionId]
              : collection.included,
          ]),
        ])
      })
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
      if (status === 401 || status === 403) onAccessFailure(status)
      setMessage({
        tone: 'error',
        text: status === 404
          ? '이 장소 또는 카테고리를 더 이상 찾을 수 없습니다.'
          : status === 503
            ? '카테고리 목록을 불러올 수 없습니다. 잠시 뒤 다시 시도해 주세요.'
            : '카테고리 목록을 불러오지 못했습니다.',
      })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [onAccessFailure])

  useEffect(() => {
    setFiling(undefined)
    setDesired({})
    setMessage(undefined)
    setRetryRequest(undefined)
    if (placeId === undefined) return
    const controller = new AbortController()
    void load(placeId, undefined, false, false, controller.signal)
    return () => controller.abort()
  }, [load, placeId])

  const changes = useMemo(() => filing?.collections.flatMap((collection) => {
    const included = desired[collection.collectionId] ?? collection.included
    return included === collection.included ? [] : [{
      collectionId: collection.collectionId,
      expectedCollectionRevision: collection.collectionRevision,
      desired: included ? 'included' as const : 'excluded' as const,
    }]
  }) ?? [], [desired, filing])

  const execute = useCallback(async (request: PlaceFilingCommandRequestV2) => {
    if (placeId === undefined || saving) return
    setSaving(true)
    setMessage(undefined)
    try {
      const result = await collectionLibraryHttp.filingCommand(request)
      if (result.outcome === 'accepted') {
        setRetryRequest(undefined)
        setMessage({
          tone: 'success',
          text: result.receipt.status === 'replayed'
            ? '이전 요청 결과를 확인했습니다.'
            : '내 카테고리를 저장했습니다.',
        })
        await Promise.all([onApplied(), load(placeId)])
        return
      }
      if (result.rejection.code === 'version-conflict') {
        setRetryRequest(undefined)
        setMessage({
          tone: 'warning',
          text: '다른 곳에서 카테고리가 변경되었습니다. 선택은 유지했으니 최신 상태를 확인하고 다시 저장해 주세요.',
        })
        await load(placeId, undefined, false, true)
        return
      }
      setRetryRequest(undefined)
      setMessage({
        tone: 'error',
        text: result.rejection.code === 'not-found'
          ? '변경 대상이 더 이상 존재하지 않습니다.'
          : result.rejection.code === 'collection-limit-exceeded'
            ? '이 카테고리에는 장소를 더 추가할 수 없습니다.'
            : '선택한 변경을 적용할 수 없습니다. 최신 목록을 확인해 주세요.',
      })
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
      if (status === 401 || status === 403) onAccessFailure(status)
      setRetryRequest(request)
      setMessage({
        tone: 'error',
        text: status === 503
          ? '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인할 수 있습니다.'
          : '카테고리 변경을 저장하지 못했습니다.',
      })
    } finally {
      setSaving(false)
    }
  }, [load, onAccessFailure, onApplied, placeId, saving])

  const save = () => {
    if (placeId === undefined || changes.length === 0) return Promise.resolve()
    const request: PlaceFilingCommandRequestV2 = {
      schemaVersion: 'place-filing-command.v2',
      commandId: crypto.randomUUID(),
      placeId,
      changes,
    }
    setRetryRequest(request)
    return execute(request)
  }

  return {
    filing,
    desired,
    loading,
    loadingMore,
    saving,
    message,
    dirtyCount: changes.length,
    toggle: (collectionId: string) => setDesired((current) => ({
      ...current,
      [collectionId]: !(current[collectionId] ?? false),
    })),
    save,
    retrySave: () => retryRequest === undefined ? undefined : execute(retryRequest),
    retryLoad: () => placeId === undefined ? undefined : load(placeId),
    loadMore: () => (
      placeId === undefined || filing?.nextCursor === undefined
        ? undefined
        : load(placeId, filing.nextCursor, true)
    ),
  }
}

export type PlaceFilingWorkflow = ReturnType<typeof usePlaceFilingWorkflow>
