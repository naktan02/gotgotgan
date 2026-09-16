'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type DiscoveryCollection,
  type DiscoveryCollectionDetail,
  type DiscoveryCopyAttempt,
  type DiscoveryDirectoryPage,
  type DiscoveryFilters,
  type DiscoveryGateway,
  DiscoveryHttpProblem,
  type DiscoveryReportReason,
} from './public-collection-discovery-model'

type LoadState = 'loading' | 'ready' | 'authentication-required' | 'forbidden' | 'not-found' | 'unavailable'
type CopyState =
  | Readonly<{ kind: 'idle' | 'copying' }>
  | Readonly<{ kind: 'copied'; targetCollectionId: string }>
  | Readonly<{ kind: 'authentication-required' | 'forbidden' | 'not-found' | 'conflict' | 'invalid-selection' | 'unavailable' }>
type ReportState = 'idle' | 'reporting' | 'reported' | 'authentication-required' | 'forbidden' | 'conflict' | 'unavailable'
type MobileSurface = 'directory' | 'detail'

const initialFilters: DiscoveryFilters = {
  query: '', areaKey: '', taxonomyKey: '', topicKey: '', sort: 'recent',
}

function loadState(error: unknown): Exclude<LoadState, 'loading' | 'ready'> {
  if (!(error instanceof DiscoveryHttpProblem)) return 'unavailable'
  if (error.status === 401) return 'authentication-required'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  return 'unavailable'
}

function copyFailure(error: unknown): Exclude<CopyState, { kind: 'idle' | 'copying' | 'copied' }>['kind'] {
  if (!(error instanceof DiscoveryHttpProblem)) return 'unavailable'
  if (error.status === 401) return 'authentication-required'
  if (error.status === 403) return 'forbidden'
  if (error.status === 404) return 'not-found'
  if (error.status === 409) return 'conflict'
  if (error.status === 422) return 'invalid-selection'
  return 'unavailable'
}

function appendUnique<T extends Readonly<{ publicationId: string }>>(current: readonly T[], incoming: readonly T[]): T[] {
  const result = new Map(current.map((item) => [item.publicationId, item]))
  for (const item of incoming) result.set(item.publicationId, item)
  return [...result.values()]
}

function appendPlaces(
  current: DiscoveryCollectionDetail,
  incoming: DiscoveryCollectionDetail,
): DiscoveryCollectionDetail {
  const places = new Map(current.places.map((place) => [place.placeId, place]))
  for (const place of incoming.places) places.set(place.placeId, place)
  return {
    ...incoming,
    places: [...places.values()].sort((left, right) => left.position - right.position),
  }
}

export function usePublicCollectionDiscovery(gateway: DiscoveryGateway) {
  const [draftQuery, setDraftQuery] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [directory, setDirectory] = useState<DiscoveryDirectoryPage>()
  const [directoryState, setDirectoryState] = useState<LoadState>('loading')
  const [directoryLoadingMore, setDirectoryLoadingMore] = useState(false)
  const [directoryPageError, setDirectoryPageError] = useState(false)
  const [selectedPublicationId, setSelectedPublicationId] = useState<string>()
  const [detail, setDetail] = useState<DiscoveryCollectionDetail>()
  const [detailState, setDetailState] = useState<LoadState>('loading')
  const [detailLoadingMore, setDetailLoadingMore] = useState(false)
  const [detailPageError, setDetailPageError] = useState(false)
  const [selectedMapPlaceId, setSelectedMapPlaceId] = useState<string>()
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<Set<string>>(new Set())
  const [copyState, setCopyState] = useState<CopyState>({ kind: 'idle' })
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<DiscoveryReportReason>('spam')
  const [reportState, setReportState] = useState<ReportState>('idle')
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>('directory')
  const directoryRequest = useRef(0)
  const detailRequest = useRef(0)
  const directoryAbort = useRef<AbortController | undefined>(undefined)
  const detailAbort = useRef<AbortController | undefined>(undefined)
  const copyAttempt = useRef<DiscoveryCopyAttempt | undefined>(undefined)
  const copyKey = useRef<string | undefined>(undefined)

  const select = useCallback((publicationId: string) => {
    setSelectedPublicationId(publicationId)
    setMobileSurface('detail')
  }, [])

  const loadDirectory = useCallback(async (cursor?: string) => {
    const append = cursor !== undefined
    const sequence = ++directoryRequest.current
    directoryAbort.current?.abort()
    const controller = new AbortController()
    directoryAbort.current = controller
    if (append) { setDirectoryLoadingMore(true); setDirectoryPageError(false) }
    else setDirectoryState('loading')
    try {
      const page = await gateway.directory(
        { ...filters, ...(cursor === undefined ? {} : { cursor }) },
        controller.signal,
      )
      if (sequence !== directoryRequest.current) return
      setDirectory((current) => append && current !== undefined
        ? { ...page, items: appendUnique(current.items, page.items) }
        : page)
      setDirectoryState('ready')
      if (!append) setSelectedPublicationId((current) => (
        current !== undefined && page.items.some((item) => item.publicationId === current)
          ? current
          : (page.items[0]?.publicationId ?? '')
      ))
    } catch (error) {
      if (sequence === directoryRequest.current && !controller.signal.aborted) {
        if (append) setDirectoryPageError(true)
        else setDirectoryState(loadState(error))
      }
    } finally {
      if (sequence === directoryRequest.current) setDirectoryLoadingMore(false)
    }
  }, [filters, gateway])

  useEffect(() => { void loadDirectory() }, [loadDirectory])

  const loadDetail = useCallback(async (publicationId: string, cursor?: string) => {
    if (publicationId === '') {
      setDetail(undefined)
      setDetailState('ready')
      return
    }
    const append = cursor !== undefined
    const sequence = ++detailRequest.current
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    if (append) { setDetailLoadingMore(true); setDetailPageError(false) }
    else setDetailState('loading')
    try {
      const next = await gateway.detail(publicationId, cursor, controller.signal)
      if (sequence !== detailRequest.current) return
      setDetail((current) => append && current !== undefined ? appendPlaces(current, next) : next)
      setDetailState('ready')
    } catch (error) {
      if (sequence === detailRequest.current && !controller.signal.aborted) {
        if (append) setDetailPageError(true)
        else setDetailState(loadState(error))
      }
    } finally {
      if (sequence === detailRequest.current) setDetailLoadingMore(false)
    }
  }, [gateway])

  useEffect(() => {
    setDetail(undefined)
    setSelectedPlaceIds(new Set())
    setSelectedMapPlaceId(undefined)
    setCopyState({ kind: 'idle' })
    setShareStatus('idle')
    setReportOpen(false)
    setReportState('idle')
    copyAttempt.current = undefined
    copyKey.current = undefined
    if (selectedPublicationId !== undefined) void loadDetail(selectedPublicationId)
  }, [loadDetail, selectedPublicationId])

  useEffect(() => () => {
    directoryAbort.current?.abort()
    detailAbort.current?.abort()
  }, [])

  const changeFilter = useCallback(<Key extends keyof DiscoveryFilters>(key: Key, value: DiscoveryFilters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setMobileSurface('directory')
  }, [])

  const submitSearch = useCallback(() => {
    changeFilter('query', draftQuery.trim())
  }, [changeFilter, draftQuery])

  const resetFilters = useCallback(() => {
    setDraftQuery('')
    setFilters(initialFilters)
    setMobileSurface('directory')
  }, [])

  const togglePlace = useCallback((placeId: string) => {
    setSelectedPlaceIds((current) => {
      const next = new Set(current)
      if (next.has(placeId)) next.delete(placeId)
      else next.add(placeId)
      return next
    })
    setCopyState({ kind: 'idle' })
    copyAttempt.current = undefined
    copyKey.current = undefined
  }, [])

  const copy = useCallback(async (kind: 'all' | 'places') => {
    if (detail === undefined || copyState.kind === 'copying') return
    const ids = [...selectedPlaceIds].sort()
    if (kind === 'places' && ids.length === 0) {
      setCopyState({ kind: 'invalid-selection' })
      return
    }
    const key = `${detail.publicationId}:${detail.publicationVersion}:${kind}:${ids.join(',')}`
    if (copyKey.current !== key || copyAttempt.current === undefined) {
      copyKey.current = key
      copyAttempt.current = gateway.createCopyAttempt({
        collection: detail,
        selection: kind === 'all' ? { kind: 'all' } : { kind: 'places', placeIds: ids },
      })
    }
    const attempt = copyAttempt.current
    setCopyState({ kind: 'copying' })
    try {
      await attempt.execute()
      setCopyState({ kind: 'copied', targetCollectionId: attempt.targetCollectionId })
      copyAttempt.current = undefined
      copyKey.current = undefined
    } catch (error) {
      const kind = copyFailure(error)
      setCopyState({ kind })
      if (kind === 'conflict' || kind === 'not-found') void loadDetail(detail.publicationId)
    }
  }, [copyState.kind, detail, gateway, loadDetail, selectedPlaceIds])

  const share = useCallback(async () => {
    if (detail === undefined) return
    const url = new URL(`/share/collections/${detail.publicationId}`, window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(url)
      setShareStatus('copied')
    } catch {
      setShareStatus('unavailable')
    }
  }, [detail])

  const report = useCallback(async () => {
    if (detail === undefined || reportState === 'reporting') return
    setReportState('reporting')
    try {
      await gateway.report(detail.owner.handle, reportReason)
      setReportState('reported')
      setReportOpen(false)
    } catch (error) {
      if (error instanceof DiscoveryHttpProblem && error.status === 401) setReportState('authentication-required')
      else if (error instanceof DiscoveryHttpProblem && error.status === 403) setReportState('forbidden')
      else if (error instanceof DiscoveryHttpProblem && error.status === 409) setReportState('conflict')
      else setReportState('unavailable')
    }
  }, [detail, gateway, reportReason, reportState])

  const selectedCollection = useMemo<DiscoveryCollection | undefined>(() => (
    directory?.items.find((item) => item.publicationId === selectedPublicationId)
  ), [directory, selectedPublicationId])

  return {
    draftQuery, filters, directory, directoryState, directoryLoadingMore, directoryPageError,
    selectedPublicationId, selectedCollection, detail, detailState, detailLoadingMore, detailPageError,
    selectedPlaceIds, selectedMapPlaceId, copyState, shareStatus, reportOpen, reportReason, reportState,
    mobileSurface,
    setDraftQuery, submitSearch, changeFilter, resetFilters, select, togglePlace, copy, share,
    setMapSelectedPlaceId: setSelectedMapPlaceId, setReportOpen, setReportReason, report,
    showMobileDirectory: () => setMobileSurface('directory'),
    retryDirectory: () => loadDirectory(),
    loadMoreDirectory: () => directory?.nextCursor === undefined ? undefined : loadDirectory(directory.nextCursor),
    retryDetail: () => selectedPublicationId === undefined ? undefined : loadDetail(selectedPublicationId),
    loadMoreDetail: () => detail?.nextCursor === undefined ? undefined : loadDetail(detail.publicationId, detail.nextCursor),
  }
}

export type PublicCollectionDiscoveryWorkflow = ReturnType<typeof usePublicCollectionDiscovery>
