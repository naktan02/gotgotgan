'use client'

import {
  type LibraryCollectionListResponse,
  type LibraryPlaceFacetsResponse,
  type LibraryPlaceState,
  type LibraryTagListResponse,
  type LibraryTagMatch,
} from '@place/contracts/library'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
  type PersonalLibraryRow,
} from './personal-library-http'
import { usePersonalLibraryManagementWorkflow } from './personal-library-management'

type LibrarySurface =
  | Readonly<{ kind: 'state'; state: LibraryPlaceState }>
  | Readonly<{ kind: 'collection'; collectionId: string }>

export function usePersonalLibraryWorkflow() {
  const [mode, setMode] = useState<'browse' | 'manage'>('browse')
  const [mobileSurface, setMobileSurface] = useState<'list' | 'map' | 'detail'>('list')
  const [surface, setSurface] = useState<LibrarySurface>({ kind: 'state', state: 'saved' })
  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([])
  const [tagMatch, setTagMatch] = useState<LibraryTagMatch>('all')
  const [selectedAreaKeys, setSelectedAreaKeys] = useState<readonly string[]>([])
  const [selectedTaxonomyKeys, setSelectedTaxonomyKeys] = useState<readonly string[]>([])
  const [facets, setFacets] = useState<LibraryPlaceFacetsResponse | undefined>()
  const [tags, setTags] = useState<LibraryTagListResponse['items']>([])
  const [tagCursor, setTagCursor] = useState<string | undefined>()
  const [collections, setCollections] = useState<LibraryCollectionListResponse['items']>([])
  const [collectionCursor, setCollectionCursor] = useState<string | undefined>()
  const [rows, setRows] = useState<readonly PersonalLibraryRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | undefined>()
  const [collectionName, setCollectionName] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [metadataLoading, setMetadataLoading] = useState(true)
  const [authenticationRequired, setAuthenticationRequired] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const requestSequence = useRef(0)

  const handleFailure = useCallback((reason: unknown) => {
    if (reason instanceof DOMException && reason.name === 'AbortError') return
    const status = reason instanceof BrowserLibraryProblem ? reason.status : undefined
    if (status === 401) {
      setAuthenticationRequired(true)
      setError(undefined)
      return
    }
    if (status === 403) {
      setError('현재 등급에서는 이 기능을 사용할 수 없습니다.')
      return
    }
    setError('라이브러리를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }, [])

  const loadTags = useCallback(async (cursor?: string, append = false) => {
    const parsed = await personalLibraryHttp.tags(cursor)
    setTags((current) => append ? [...current, ...parsed.items] : parsed.items)
    setTagCursor(parsed.nextCursor)
  }, [])

  const loadFacets = useCallback(async () => {
    setFacets(await personalLibraryHttp.facets())
  }, [])

  const loadCollections = useCallback(async (cursor?: string, append = false) => {
    const parsed = await personalLibraryHttp.collections(cursor)
    setCollections((current) => append ? [...current, ...parsed.items] : parsed.items)
    setCollectionCursor(parsed.nextCursor)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setMetadataLoading(true)
    Promise.all([
      personalLibraryHttp.facets(controller.signal),
      personalLibraryHttp.tags(undefined, controller.signal),
      personalLibraryHttp.collections(undefined, controller.signal),
    ])
      .then(([facetPage, tagPage, collectionPage]) => {
        setFacets(facetPage)
        setTags(tagPage.items)
        setTagCursor(tagPage.nextCursor)
        setCollections(collectionPage.items)
        setCollectionCursor(collectionPage.nextCursor)
      })
      .catch(handleFailure)
      .finally(() => setMetadataLoading(false))
    return () => controller.abort()
  }, [handleFailure])

  const loadRows = useCallback(async (
    cursor: string | undefined,
    append: boolean,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    try {
      const page = surface.kind === 'collection'
        ? await personalLibraryHttp.collection(surface.collectionId, cursor, signal)
        : await personalLibraryHttp.places(
            surface.state,
            selectedTagIds,
            tagMatch,
            selectedAreaKeys,
            selectedTaxonomyKeys,
            cursor,
            signal,
          )
      if (sequence !== requestSequence.current) return
      setCollectionName(page.collectionName)
      setRows((current) => {
        const available = append ? [...current, ...page.rows] : page.rows
        setSelectedPlaceId((selected) => (
          selected !== undefined && available.some((row) => row.placeId === selected)
            ? selected
            : available[0]?.placeId
        ))
        return available
      })
      setNextCursor(page.nextCursor)
      setAuthenticationRequired(false)
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (!append) {
        setRows([])
        setSelectedPlaceId(undefined)
      }
      handleFailure(reason)
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [handleFailure, selectedAreaKeys, selectedTagIds, selectedTaxonomyKeys, surface, tagMatch])

  useEffect(() => {
    const controller = new AbortController()
    void loadRows(undefined, false, controller.signal)
    return () => controller.abort()
  }, [loadRows])

  const selectedRow = rows.find((row) => row.placeId === selectedPlaceId)

  function chooseState(state: LibraryPlaceState) {
    setMobileSurface('list')
    setSurface({ kind: 'state', state })
  }

  function chooseCollection(collectionId: string) {
    setMobileSurface('list')
    setSelectedTagIds([])
    setTagMatch('all')
    setSelectedAreaKeys([])
    setSelectedTaxonomyKeys([])
    setSurface({ kind: 'collection', collectionId })
  }

  function toggleTag(tagId: string) {
    setMobileSurface('list')
    setSelectedTagIds((current) => (
      current.includes(tagId)
        ? current.filter((candidate) => candidate !== tagId)
        : [...current, tagId]
    ))
    setSurface((current) => current.kind === 'state' ? current : { kind: 'state', state: 'saved' })
  }

  function toggleArea(areaKey: string) {
    setMobileSurface('list')
    setSelectedAreaKeys((current) => (
      current.includes(areaKey)
        ? current.filter((candidate) => candidate !== areaKey)
        : current.length >= 10 ? current : [...current, areaKey]
    ))
    setSurface((current) => current.kind === 'state' ? current : { kind: 'state', state: 'saved' })
  }

  function toggleTaxonomy(taxonomyKey: string) {
    setMobileSurface('list')
    setSelectedTaxonomyKeys((current) => (
      current.includes(taxonomyKey)
        ? current.filter((candidate) => candidate !== taxonomyKey)
        : current.length >= 10 ? current : [...current, taxonomyKey]
    ))
    setSurface((current) => current.kind === 'state' ? current : { kind: 'state', state: 'saved' })
  }

  function loadMore() {
    if (nextCursor === undefined) return
    void loadRows(nextCursor, true)
  }

  const refreshLibrary = useCallback(async () => {
    await Promise.all([
      loadFacets(),
      loadTags(),
      loadCollections(),
      loadRows(undefined, false),
    ])
  }, [loadCollections, loadFacets, loadRows, loadTags])

  const refreshMetadata = useCallback(async () => {
    await Promise.all([loadTags(), loadCollections()])
  }, [loadCollections, loadTags])

  const loadMoreTags = useCallback(() => tagCursor === undefined
    ? undefined
    : loadTags(tagCursor, true).catch(handleFailure), [handleFailure, loadTags, tagCursor])
  const loadMoreCollections = useCallback(() => collectionCursor === undefined
    ? undefined
    : loadCollections(collectionCursor, true).catch(handleFailure), [
      collectionCursor,
      handleFailure,
      loadCollections,
    ])

  const managementWorkflow = usePersonalLibraryManagementWorkflow({
    active: mode === 'manage',
    collections,
    tags,
    metadataLoading,
    collectionCursor,
    tagCursor,
    loadMoreCollections,
    loadMoreTags,
    refreshMetadata,
    onAccessFailure: handleFailure,
    onCollectionDeleted: (collectionId) => {
      setSurface((current) => current.kind === 'collection' &&
        current.collectionId === collectionId
        ? { kind: 'state', state: 'saved' }
        : current)
    },
    onTagDeleted: (tagId) => {
      setSelectedTagIds((current) => current.filter((candidate) => candidate !== tagId))
    },
  })
  return {
    mode,
    mobileSurface,
    surface,
    selectedTagIds,
    tagMatch,
    selectedAreaKeys,
    selectedTaxonomyKeys,
    facets,
    tags,
    tagCursor,
    collections,
    collectionCursor,
    rows,
    nextCursor,
    selectedPlaceId,
    selectedRow,
    ...managementWorkflow,
    collectionName,
    loading,
    loadingMore,
    metadataLoading,
    authenticationRequired,
    error,
    refreshAfterPlaceChange: refreshLibrary,
    showBrowse: () => {
      setMode('browse')
      setMobileSurface('list')
      void refreshLibrary().catch(handleFailure)
    },
    showManagement: () => setMode('manage'),
    chooseState,
    chooseCollection,
    toggleTag,
    toggleArea,
    toggleTaxonomy,
    setTagMatch,
    showMobileSurface: (nextSurface: 'list' | 'map') => setMobileSurface(nextSurface),
    selectPlace: (placeId: string) => {
      setSelectedPlaceId(placeId)
      setMobileSurface('detail')
    },
    dismissDetail: () => {
      setMobileSurface('list')
      setSelectedPlaceId(undefined)
    },
    loadMore,
    retry: () => Promise.all([
      loadFacets(),
      loadTags(),
      loadCollections(),
      loadRows(undefined, false),
    ]).catch(handleFailure),
    loadMoreTags,
    loadMoreCollections,
  }
}

export type PersonalLibraryWorkflow = ReturnType<typeof usePersonalLibraryWorkflow>
