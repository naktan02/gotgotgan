'use client'

import type { CatalogSearchInterpretationToken, SearchBounds } from '@place/contracts/search'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { PlaceMapViewport } from '@/platform/maps/place-map-interface'

import { catalogHomeClient } from './catalog-home-client'

export const catalogQuickTypes = ['음식점', '카페', '관광지', '쇼핑', '문화시설', '숙박'] as const

export type CatalogHomePlace = Readonly<{
  placeId: string
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  taxonomyLabel: string | null
  evidenceStatus: 'verified' | 'unverified' | 'conflicted' | 'stale'
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
  filePlace: (input: Readonly<{ placeId: string; collectionId: string }>) => Promise<
    Readonly<{ kind: 'success' | 'unavailable' }>
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
  collectionMutation: 'idle' | 'loading' | 'success' | 'unavailable'
  collectionMessage: string | undefined
  recentlyFiled: readonly Readonly<{ place: CatalogHomePlace; collectionName: string }>[]
  viewport: PlaceMapViewport
  mobileSurface: 'list' | 'map'
  changeDraftQuery: (query: string) => void
  submitSearch: () => void
  toggleQuickType: (value: string) => void
  excludeToken: (tokenId: string) => void
  selectPlace: (placeId: string) => void
  setCollectionPickerOpen: (open: boolean) => void
  fileInCollection: (collection: FavoriteCollection) => void
  setViewport: (viewport: PlaceMapViewport) => void
  searchViewport: () => void
  loadMore: () => void
  showList: () => void
  showMap: () => void
}>

const initialViewport: PlaceMapViewport = {
  zoom: 11,
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
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [searchError, setSearchError] = useState<string>()
  const [nextCursor, setNextCursor] = useState<string>()
  const [paginationState, setPaginationState] = useState<'idle' | 'loading' | 'unavailable'>('idle')
  const [activeSearchBounds, setActiveSearchBounds] = useState<SearchBounds>()
  const [collections, setCollections] = useState<readonly FavoriteCollection[]>([])
  const [collectionState, setCollectionState] = useState<CollectionState>('loading')
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false)
  const [collectionMutation, setCollectionMutation] = useState<'idle' | 'loading' | 'success' | 'unavailable'>('idle')
  const [collectionMessage, setCollectionMessage] = useState<string>()
  const [recentlyFiled, setRecentlyFiled] = useState<readonly Readonly<{ place: CatalogHomePlace; collectionName: string }>[] >([])
  const [viewport, setViewport] = useState<PlaceMapViewport>(initialViewport)
  const [mobileSurface, setMobileSurface] = useState<'list' | 'map'>('list')
  const searchSequence = useRef(0)
  const searchController = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    library.readCollections(controller.signal)
      .then((result) => {
        if (result.kind === 'ready') {
          setCollections(result.items)
          setCollectionState('ready')
          return
        }
        setCollectionState(result.kind)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setCollectionState('unavailable')
      })
    return () => controller.abort()
  }, [library])

  const executeSearch = useCallback(async (
    query: string,
    quickType: string | null,
    exclusions: readonly string[],
    bounds?: SearchBounds,
    cursor?: string,
  ) => {
    const effectiveQuery = normalize([query, quickType].filter(Boolean).join(' '))
    if (effectiveQuery.length === 0) {
      searchController.current?.abort()
      setSubmittedQuery('')
      setItems([])
      setInterpretation([])
      setSelectedPlaceId(undefined)
      setSearchState('idle')
      setNextCursor(undefined)
      setPaginationState('idle')
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
      setSubmittedQuery(query)
      setActiveSearchBounds(bounds)
      setSearchState('loading')
      setSearchError(undefined)
      setNextCursor(undefined)
      setPaginationState('idle')
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
        setSelectedPlaceId((current) => places.some((item) => item.placeId === current)
          ? current
          : places[0]?.placeId)
        if (page.mapBounds !== null) setViewport((current) => ({ ...current, bounds: page.mapBounds! }))
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
        setSelectedPlaceId(undefined)
        setSearchState('unavailable')
        setSearchError('카탈로그 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }
    }
  }, [])

  useEffect(() => {
    const query = normalize(initialQuery)
    if (query.length > 0) void executeSearch(query, null, [])
    return () => searchController.current?.abort()
  }, [executeSearch, initialQuery])

  const selected = items.find((item) => item.placeId === selectedPlaceId)
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
  const fileInCollection = (collection: FavoriteCollection) => {
    if (selected === undefined || collectionMutation === 'loading') return
    setCollectionMutation('loading')
    setCollectionMessage(undefined)
    void library.filePlace({
      collectionId: collection.collectionId,
      placeId: selected.placeId,
    }).then((result) => {
      if (result.kind !== 'success') throw new Error('Collection filing unavailable')
      setCollectionMutation('success')
      setCollectionMessage(`‘${collection.name}’에 정리했습니다.`)
      setCollectionPickerOpen(false)
      setRecentlyFiled((current) => [
        { place: selected, collectionName: collection.name },
        ...current.filter((item) => item.place.placeId !== selected.placeId),
      ].slice(0, 3))
    }).catch(() => {
      setCollectionMutation('unavailable')
      setCollectionMessage('컬렉션에 정리하지 못했습니다. 다시 시도해 주세요.')
    })
  }

  const value = useMemo<CatalogHomeWorkflow>(() => ({
    draftQuery, submittedQuery, selectedQuickType, interpretation, items, selected,
    searchState, searchError, nextCursor, paginationState,
    collections, collectionState, collectionPickerOpen,
    collectionMutation, collectionMessage, recentlyFiled, viewport, mobileSurface,
    changeDraftQuery: setDraftQuery,
    submitSearch,
    toggleQuickType,
    excludeToken,
    selectPlace: (placeId) => {
      setSelectedPlaceId(placeId)
      setCollectionPickerOpen(false)
      setMobileSurface('map')
    },
    setCollectionPickerOpen,
    fileInCollection,
    setViewport,
    searchViewport: () => void executeSearch(submittedQuery, selectedQuickType, excludedTokenIds, viewport.bounds),
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
    showList: () => setMobileSurface('list'),
    showMap: () => setMobileSurface('map'),
  }), [
    collectionMessage, collectionMutation, collectionPickerOpen, collectionState, collections,
    activeSearchBounds, draftQuery, excludedTokenIds, executeSearch, interpretation, items,
    mobileSurface, nextCursor, paginationState, recentlyFiled, searchError, searchState, selected,
    selectedQuickType, submittedQuery, viewport,
  ])

  return <CatalogHomeContext.Provider value={value}>{children}</CatalogHomeContext.Provider>
}

export function useCatalogHome() {
  const value = useContext(CatalogHomeContext)
  if (value === undefined) throw new Error('CatalogHomeProvider is required')
  return value
}
