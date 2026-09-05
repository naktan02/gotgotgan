'use client'

import type { CatalogSearchInterpretationToken, SearchBounds } from '@place/contracts/search'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { PlaceMapCluster, PlaceMapMarker, PlaceMapViewport } from '@/platform/maps/public'

import { catalogHomeClient } from './catalog-home-client'
import { createCatalogMapRequestGuard } from './catalog-map-request-guard'

export const catalogQuickTypes = ['음식점', '카페', '관광지', '쇼핑', '문화시설', '숙박'] as const

export type CatalogHomePlace = Readonly<{
  placeId: string
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  taxonomyLabel: string | null
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale' | 'unknown'
}>

export type FavoriteCollection = Readonly<{
  collectionId: string
  name: string
  placeCount: number
}>

export type CatalogHomeLibrary = Readonly<{
  readCollections: (signal: AbortSignal) => Promise<
    | Readonly<{ kind: 'ready'; items: readonly FavoriteCollection[] }>
    | Readonly<{ kind: 'signed-out' | 'unavailable' }>
  >
}>

type CollectionState = 'loading' | 'ready' | 'signed-out' | 'unavailable'
type SearchState = 'idle' | 'loading' | 'ready' | 'unavailable'

export type CatalogHomeWorkflow = Readonly<{
  draftQuery: string
  submittedQuery: string
  selectedQuickType: string | null
  interpretation: readonly CatalogSearchInterpretationToken[]
  items: readonly CatalogHomePlace[]
  selected: CatalogHomePlace | undefined
  searchState: SearchState
  searchError: string | undefined
  nextCursor: string | undefined
  paginationState: 'idle' | 'loading' | 'unavailable'
  collections: readonly FavoriteCollection[]
  collectionState: CollectionState
  collectionPickerOpen: boolean
  viewport: PlaceMapViewport
  mapMarkers: readonly PlaceMapMarker[]
  mapClusters: readonly PlaceMapCluster[]
  mapState: 'idle' | 'loading' | 'ready' | 'unavailable'
  mapDescription: string
  changeDraftQuery: (query: string) => void
  submitSearch: () => void
  toggleQuickType: (value: string) => void
  excludeToken: (tokenId: string) => void
  selectPlace: (placeId: string) => void
  setCollectionPickerOpen: (open: boolean) => void
  onFilingApplied: () => Promise<void>
  onFilingAccessFailure: (status: number) => void
  setViewport: (viewport: PlaceMapViewport) => void
  selectMapCluster: (cluster: PlaceMapCluster) => void
  loadMore: () => void
}>

const initialViewport: PlaceMapViewport = {
  zoom: 12,
  bounds: { west: 126.76, south: 37.39, east: 127.22, north: 37.72 },
}

const CatalogHomeContext = createContext<CatalogHomeWorkflow | undefined>(undefined)

function normalize(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function CatalogHomeProvider({
  children,
  initialQuery = '',
  library,
}: Readonly<{ children: React.ReactNode; initialQuery?: string; library: CatalogHomeLibrary }>) {
  const [draftQuery, setDraftQuery] = useState(() => normalize(initialQuery))
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [selectedQuickType, setSelectedQuickType] = useState<string | null>(null)
  const [excludedTokenIds, setExcludedTokenIds] = useState<readonly string[]>([])
  const [interpretation, setInterpretation] = useState<readonly CatalogSearchInterpretationToken[]>([])
  const [items, setItems] = useState<readonly CatalogHomePlace[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>()
  const [selectedSummary, setSelectedSummary] = useState<CatalogHomePlace>()
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [searchError, setSearchError] = useState<string>()
  const [nextCursor, setNextCursor] = useState<string>()
  const [paginationState, setPaginationState] = useState<'idle' | 'loading' | 'unavailable'>('idle')
  const [activeSearchBounds, setActiveSearchBounds] = useState<SearchBounds>()
  const [collections, setCollections] = useState<readonly FavoriteCollection[]>([])
  const [collectionState, setCollectionState] = useState<CollectionState>('loading')
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false)
  const [viewport, setViewport] = useState<PlaceMapViewport>(initialViewport)
  const [mapMarkers, setMapMarkers] = useState<readonly PlaceMapMarker[]>([])
  const [mapClusters, setMapClusters] = useState<readonly PlaceMapCluster[]>([])
  const [mapState, setMapState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [mapDescription, setMapDescription] = useState('검색하면 현재 지도 영역의 장소를 표시합니다.')
  const searchSequence = useRef(0)
  const searchController = useRef<AbortController | undefined>(undefined)
  const mapRequests = useRef(createCatalogMapRequestGuard())
  const viewportRef = useRef(initialViewport)
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const updateViewport = useCallback((next: PlaceMapViewport) => {
    viewportRef.current = next
    setViewport(next)
  }, [])

  const executeMapSearch = useCallback(async (
    query: string,
    exclusions: readonly string[],
    nextViewport: PlaceMapViewport,
  ) => {
    const request = mapRequests.current.start()
    setMapState('loading')
    try {
      const projection = await catalogHomeClient.map({
        query,
        excludedTokenIds: exclusions,
        viewport: nextViewport.bounds,
        zoom: nextViewport.zoom,
        signal: request.signal,
      })
      if (!mapRequests.current.isCurrent(request.generation)) return
      setMapMarkers(projection.features.flatMap((feature) => feature.kind === 'place' ? [{
        id: feature.placeId,
        label: feature.name,
        location: feature.location,
      }] : []))
      setMapClusters(projection.features.flatMap((feature) => feature.kind === 'cluster' ? [{
        id: feature.featureId,
        count: feature.placeCount,
        location: feature.location,
        bounds: feature.bounds,
      }] : []))
      setMapDescription(
        `현재 영역에서 ${projection.coverage.representedPlaceCount}곳을 ${projection.mode === 'clusters' ? '묶음' : '개별 장소'}으로 표시했습니다.`,
      )
      setMapState('ready')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (!mapRequests.current.isCurrent(request.generation)) return
      setMapMarkers([])
      setMapClusters([])
      setMapDescription('현재 영역의 지도 장소를 불러오지 못했습니다. 목록은 계속 사용할 수 있습니다.')
      setMapState('unavailable')
    }
  }, [])

  const loadCollections = useCallback(async (signal: AbortSignal) => {
    try {
      const result = await library.readCollections(signal)
      if (result.kind === 'ready') {
        setCollections(result.items)
        setCollectionState('ready')
        return
      }
      setCollectionState(result.kind)
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setCollectionState('unavailable')
    }
  }, [library])

  useEffect(() => {
    const controller = new AbortController()
    void loadCollections(controller.signal)
    return () => controller.abort()
  }, [loadCollections])

  const executeSearch = useCallback(async (
    query: string,
    quickType: string | null,
    exclusions: readonly string[],
    bounds?: SearchBounds,
    cursor?: string,
    preserveSelection = false,
  ) => {
    const effectiveQuery = normalize([query, quickType].filter(Boolean).join(' '))
    clearTimeout(viewportTimer.current)
    if (effectiveQuery.length === 0) {
      searchController.current?.abort()
      mapRequests.current.invalidate()
      setSubmittedQuery('')
      setItems([])
      setInterpretation([])
      setSelectedPlaceId(undefined)
      setSelectedSummary(undefined)
      setSearchState('idle')
      setNextCursor(undefined)
      setPaginationState('idle')
      setMapMarkers([])
      setMapClusters([])
      setMapState('idle')
      return
    }
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    const sequence = ++searchSequence.current
    const appending = cursor !== undefined
    if (appending) {
      setPaginationState('loading')
    } else {
      if (!preserveSelection) setSelectedSummary(undefined)
      mapRequests.current.invalidate()
      setSubmittedQuery(query)
      setActiveSearchBounds(bounds)
      setSearchState('loading')
      setSearchError(undefined)
      setNextCursor(undefined)
      setPaginationState('idle')
      setMapState('loading')
      setMapMarkers([])
      setMapClusters([])
    }
    try {
      const page = await catalogHomeClient.search({
        query: effectiveQuery,
        excludedTokenIds: exclusions,
        signal: controller.signal,
        ...(bounds === undefined ? {} : { bounds }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      if (sequence !== searchSequence.current) return
      const places = page.items.map<CatalogHomePlace>((item) => ({
        placeId: item.placeId,
        name: item.name,
        areaLabel: item.area?.label ?? null,
        location: item.location,
        taxonomyLabel: item.primaryTaxonomy?.label ?? null,
        evidenceStatus: item.evidenceStatus,
      }))
      setItems((current) => appending
        ? [...current, ...places.filter((place) => !current.some((item) => item.placeId === place.placeId))]
        : places)
      setInterpretation(page.interpretation.tokens)
      if (!appending) {
        if (!preserveSelection) {
          setSelectedPlaceId((current) => places.some((item) => item.placeId === current)
            ? current
            : places[0]?.placeId)
        }
        const mapViewport = bounds === undefined && page.mapBounds !== null
          ? { ...viewportRef.current, bounds: page.mapBounds }
          : bounds === undefined
            ? viewportRef.current
            : { ...viewportRef.current, bounds }
        updateViewport(mapViewport)
        void executeMapSearch(effectiveQuery, exclusions, mapViewport)
      }
      setNextCursor(page.nextCursor)
      setPaginationState('idle')
      setSearchState('ready')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (sequence !== searchSequence.current) return
      if (appending) {
        setPaginationState('unavailable')
      } else {
        setItems([])
        setInterpretation([])
        if (!preserveSelection) { setSelectedPlaceId(undefined); setSelectedSummary(undefined) }
        setSearchState('unavailable')
        setSearchError('카탈로그 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        setMapState('unavailable')
        setMapDescription('검색 결과와 지도 장소를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }
    }
  }, [executeMapSearch, updateViewport])

  useEffect(() => {
    const query = normalize(initialQuery)
    if (query.length > 0) void executeSearch(query, null, [])
    return () => {
      clearTimeout(viewportTimer.current)
      searchController.current?.abort()
      mapRequests.current.invalidate()
    }
  }, [executeSearch, initialQuery])

  const selectedMapPlace = mapMarkers.find((item) => item.id === selectedPlaceId)
  const selected = (selectedSummary?.placeId === selectedPlaceId ? selectedSummary : undefined) ?? items.find((item) => item.placeId === selectedPlaceId) ?? (
    selectedMapPlace === undefined ? undefined : {
      placeId: selectedMapPlace.id, name: selectedMapPlace.label, location: selectedMapPlace.location,
      areaLabel: null, taxonomyLabel: null, evidenceStatus: 'unknown' as const,
    }
  )
  const submitSearch = () => {
    const query = normalize(draftQuery)
    setDraftQuery(query)
    setExcludedTokenIds([])
    void executeSearch(query, selectedQuickType, [])
  }
  const toggleQuickType = (value: string) => {
    const next = selectedQuickType === value ? null : value
    setSelectedQuickType(next)
    setExcludedTokenIds([])
    void executeSearch(normalize(draftQuery), next, [])
  }
  const excludeToken = (tokenId: string) => {
    const next = [...new Set([...excludedTokenIds, tokenId])]
    setExcludedTokenIds(next)
    void executeSearch(submittedQuery, selectedQuickType, next)
  }
  const onFilingApplied = useCallback(async () => {
    await loadCollections(new AbortController().signal)
  }, [loadCollections])

  const onFilingAccessFailure = useCallback((status: number) => {
    setCollectionState(status === 401 ? 'signed-out' : 'unavailable')
  }, [])

  const value = useMemo<CatalogHomeWorkflow>(() => ({
    draftQuery, submittedQuery, selectedQuickType, interpretation, items, selected,
    searchState, searchError, nextCursor, paginationState,
    collections, collectionState, collectionPickerOpen,
    viewport, mapMarkers, mapClusters, mapState, mapDescription,
    changeDraftQuery: setDraftQuery,
    submitSearch,
    toggleQuickType,
    excludeToken,
    selectPlace: (placeId) => {
      const marker = mapMarkers.find((item) => item.id === placeId)
      setSelectedSummary(items.find((item) => item.placeId === placeId) ?? (marker === undefined ? undefined : {
        placeId: marker.id, name: marker.label, location: marker.location,
        areaLabel: null, taxonomyLabel: null, evidenceStatus: 'unknown',
      }))
      setSelectedPlaceId(placeId)
      setCollectionPickerOpen(false)
    },
    setCollectionPickerOpen,
    onFilingApplied,
    onFilingAccessFailure,
    setViewport: (next) => {
      updateViewport(next)
      clearTimeout(viewportTimer.current)
      if (normalize([submittedQuery, selectedQuickType].filter(Boolean).join(' ')).length > 0) {
        viewportTimer.current = setTimeout(() => {
          void executeSearch(submittedQuery, selectedQuickType, excludedTokenIds, next.bounds, undefined, true)
        }, 300)
      }
    },
    selectMapCluster: (cluster) => {
      const next = { bounds: cluster.bounds, zoom: Math.min(22, viewport.zoom + 2) }
      updateViewport(next)
      void executeSearch(submittedQuery, selectedQuickType, excludedTokenIds, next.bounds, undefined, true)
    },
    loadMore: () => {
      if (nextCursor !== undefined && paginationState !== 'loading') {
        void executeSearch(
          submittedQuery,
          selectedQuickType,
          excludedTokenIds,
          activeSearchBounds,
          nextCursor,
        )
      }
    },
  }), [
    collectionPickerOpen, collectionState, collections,
    activeSearchBounds, draftQuery, excludedTokenIds, executeSearch, interpretation, items,
    mapClusters, mapDescription, mapMarkers, mapState, nextCursor, onFilingAccessFailure, onFilingApplied, paginationState, searchError, searchState, selected,
    selectedQuickType, submittedQuery, updateViewport, viewport,
  ])

  return <CatalogHomeContext.Provider value={value}>{children}</CatalogHomeContext.Provider>
}

export function useCatalogHome() {
  const value = useContext(CatalogHomeContext)
  if (value === undefined) throw new Error('CatalogHomeProvider is required')
  return value
}
