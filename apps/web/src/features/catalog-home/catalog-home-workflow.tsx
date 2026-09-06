'use client'

import type { CatalogSearchInterpretationToken, CatalogSearchIntent, CatalogExplorationResponse, SearchBounds } from '@place/contracts/search'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { PlaceMapCluster, PlaceMapMarker, PlaceMapViewport } from '@/platform/maps/public'

import { catalogHomeClient } from './catalog-home-client'
import { createCatalogMapRequestGuard } from './catalog-map-request-guard'
import { catalogSearchNear } from './search-input/search-location'
import { createCatalogQueryIntentResolver } from './search-input/catalog-query-intent'

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
  searchIntent: CatalogSearchIntent
  destination: CatalogExplorationResponse['destinations'][number] | undefined
  chooseDestination: (destination: CatalogExplorationResponse['destinations'][number]) => void
  chooseCandidate: (candidate: CatalogExplorationResponse['places'][number]) => void
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
  submitSearch: (intent?: CatalogSearchIntent) => void
  toggleQuickType: (value: string, key?: string) => void
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
  const [searchIntent, setSearchIntent] = useState<CatalogSearchIntent>('auto')
  const intentRef = useRef<CatalogSearchIntent>('auto')
  const [destination, setDestination] = useState<CatalogExplorationResponse['destinations'][number]>()
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [selectedQuickType, setSelectedQuickType] = useState<string | null>(null)
  const taxonomyKeyRef = useRef<string | undefined>(undefined)
  const searchNearRef = useRef<ReturnType<typeof catalogSearchNear>>(undefined)
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
  const queryIntents = useRef(createCatalogQueryIntentResolver())
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
        intent: intentRef.current,
        ...(taxonomyKeyRef.current === undefined ? {} : { taxonomyKey: taxonomyKeyRef.current }),
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
    exclusions: readonly string[],
    bounds?: SearchBounds,
    cursor?: string,
    preserveSelection = false,
  ) => {
    const effectiveQuery = normalize(query)
    setDestination(undefined)
    clearTimeout(viewportTimer.current)
    if (effectiveQuery.length === 0 && !taxonomyKeyRef.current) {
      searchController.current?.abort()
      ++searchSequence.current
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
      searchNearRef.current = catalogSearchNear(viewportRef.current)
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
        intent: intentRef.current,
        ...(taxonomyKeyRef.current === undefined ? {} : { taxonomyKey: taxonomyKeyRef.current }),
        ...(searchNearRef.current === undefined ? {} : { near: searchNearRef.current }),
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
      setInterpretation(page.interpretation.tokens.filter((token) => token.kind !== 'query'))
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

  const selectedMapPlace = mapMarkers.find((item) => item.id === selectedPlaceId)
  const selected = (selectedSummary?.placeId === selectedPlaceId ? selectedSummary : undefined) ?? items.find((item) => item.placeId === selectedPlaceId) ?? (
    selectedMapPlace === undefined ? undefined : {
      placeId: selectedMapPlace.id, name: selectedMapPlace.label, location: selectedMapPlace.location,
      areaLabel: null, taxonomyLabel: null, evidenceStatus: 'unknown' as const,
    }
  )
  const chooseDestination = useCallback((next: CatalogExplorationResponse['destinations'][number]) => {
    queryIntents.current.invalidate()
    searchController.current?.abort(); mapRequests.current.invalidate(); ++searchSequence.current
    clearTimeout(viewportTimer.current)
    setDestination(next); setSelectedPlaceId(undefined); setSelectedSummary(undefined)
    setDraftQuery(next.name); setSubmittedQuery(next.name); setSelectedQuickType(null)
    intentRef.current = 'name'; setSearchIntent('name')
    taxonomyKeyRef.current = undefined
    setInterpretation([]); setItems([]); setMapMarkers([]); setMapClusters([])
    setSearchState('ready'); setMapState('ready'); setNextCursor(undefined)
    const { latitude, longitude } = next.location
    const bounds = next.bounds ?? { west: longitude - 0.12, east: longitude + 0.12, south: latitude - 0.09, north: latitude + 0.09 }
    const width = (bounds.east - bounds.west + 360) % 360 || 360
    updateViewport({ bounds, zoom: next.kind === 'city' ? 11 : Math.max(1, Math.min(7, Math.log2(360 / width))) })
  }, [updateViewport])
  const resolveQuery = useCallback((query: string, intent: CatalogSearchIntent) => {
    searchController.current?.abort(); ++searchSequence.current; mapRequests.current.invalidate()
    clearTimeout(viewportTimer.current)
    void queryIntents.current.resolve({
      query, intent, hasTaxonomy: taxonomyKeyRef.current !== undefined,
      explore: (signal) => catalogHomeClient.explore(query, AbortSignal.any([signal, AbortSignal.timeout(5_000)]), catalogSearchNear(viewportRef.current)),
      search: (nextIntent) => {
        intentRef.current = nextIntent; setSearchIntent(nextIntent)
        void executeSearch(query, [])
      },
      chooseDestination,
    })
  }, [chooseDestination, executeSearch])
  useEffect(() => {
    const query = normalize(initialQuery)
    if (query.length > 0) resolveQuery(query, 'auto')
    return () => {
      queryIntents.current.invalidate()
      clearTimeout(viewportTimer.current)
      searchController.current?.abort()
      mapRequests.current.invalidate()
    }
  }, [resolveQuery, initialQuery])
  const submitSearch = (intent: CatalogSearchIntent = 'auto') => {
    const query = normalize(draftQuery)
    setDraftQuery(query)
    setExcludedTokenIds([])
    resolveQuery(query, intent)
  }
  const toggleQuickType = (value: string, key?: string) => {
    queryIntents.current.invalidate()
    // A picker choice is selection, including reselecting the current key. Only
    // the keyless chip action removes it.
    const next = key === undefined && selectedQuickType === value ? null : value
    taxonomyKeyRef.current = next === null ? undefined : key
    intentRef.current = 'conditions'; setSearchIntent('conditions')
    setSelectedQuickType(next)
    setExcludedTokenIds([])
    void executeSearch(normalize(draftQuery), [])
  }
  const excludeToken = (tokenId: string) => {
    queryIntents.current.invalidate()
    const next = [...new Set([...excludedTokenIds, tokenId])]
    const token = interpretation.find((token) => token.tokenId === tokenId)
    const quick = token && token.kind !== 'query' && token.key === taxonomyKeyRef.current ? null : selectedQuickType
    if (quick === null) { taxonomyKeyRef.current = undefined; setSelectedQuickType(null) }
    setExcludedTokenIds(next)
    void executeSearch(submittedQuery, next)
  }
  const onFilingApplied = useCallback(async () => {
    await loadCollections(new AbortController().signal)
  }, [loadCollections])

  const onFilingAccessFailure = useCallback((status: number) => {
    setCollectionState(status === 401 ? 'signed-out' : 'unavailable')
  }, [])

  const value = useMemo<CatalogHomeWorkflow>(() => ({
    searchIntent, destination, chooseDestination,
    chooseCandidate: (candidate) => {
      queryIntents.current.invalidate()
      intentRef.current = 'name'; setSearchIntent('name'); setDestination(undefined)
      const place: CatalogHomePlace = {
        placeId: candidate.placeId, name: candidate.name, areaLabel: candidate.area?.label ?? null,
        taxonomyLabel: candidate.primaryTaxonomy?.label ?? null, location: candidate.location,
        evidenceStatus: candidate.evidenceStatus,
      }
      setDraftQuery(place.name); setSubmittedQuery(place.name); setSelectedQuickType(null)
      taxonomyKeyRef.current = undefined; clearTimeout(viewportTimer.current)
      setItems([place]); setSelectedSummary(place); setSelectedPlaceId(place.placeId)
      setInterpretation([]); setSearchState('ready'); setNextCursor(undefined)
      searchController.current?.abort(); ++searchSequence.current; mapRequests.current.invalidate()
      setMapClusters([]); setMapState('ready')
      setMapMarkers(place.location ? [{ id: place.placeId, label: place.name, location: place.location }] : [])
      if (place.location) updateViewport({ zoom: 16, bounds: {
        west: place.location.longitude - 0.003, east: place.location.longitude + 0.003,
        south: place.location.latitude - 0.002, north: place.location.latitude + 0.002,
      } })
    },
    draftQuery, submittedQuery, selectedQuickType, interpretation, items, selected,
    searchState, searchError, nextCursor, paginationState,
    collections, collectionState, collectionPickerOpen,
    viewport, mapMarkers, mapClusters, mapState, mapDescription,
    changeDraftQuery: (query) => { queryIntents.current.invalidate(); setDraftQuery(query) },
    submitSearch,
    toggleQuickType,
    excludeToken,
    selectPlace: (placeId) => {
      queryIntents.current.invalidate()
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
      if (!destination && normalize([submittedQuery, selectedQuickType].filter(Boolean).join(' ')).length > 0) {
        viewportTimer.current = setTimeout(() => {
          void executeMapSearch(submittedQuery, excludedTokenIds, next)
        }, 300)
      }
    },
    selectMapCluster: (cluster) => {
      const next = { bounds: cluster.bounds, zoom: Math.min(22, viewport.zoom + 2) }
      updateViewport(next)
      void executeMapSearch(submittedQuery, excludedTokenIds, next)
    },
    loadMore: () => {
      if (nextCursor !== undefined && paginationState !== 'loading') {
        void executeSearch(
          submittedQuery,
          excludedTokenIds,
          activeSearchBounds,
          nextCursor,
        )
      }
    },
  }), [
    collectionPickerOpen, collectionState, collections,
    searchIntent, destination, executeMapSearch,
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
