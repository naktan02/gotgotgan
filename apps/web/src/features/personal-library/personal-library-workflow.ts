'use client'

import {
  type LibraryCollectionListResponse,
  type LibraryPlaceFacetsResponse,
  type LibraryPlaceState,
  type LibraryTagListResponse,
  type LibraryTagMatch,
} from '@place/contracts/library'
import type { PlaceDetailResponse } from '@place/contracts/places'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  BrowserLibraryProblem,
  personalLibraryHttp,
  type PersonalLibraryRow,
} from './personal-library-http'
import { usePersonalLibraryManagementWorkflow } from './personal-library-management'
import { usePersonalLibraryNoteWorkflow } from './personal-library-note-workflow'
import { BrowserWritingProblem } from './personal-library-notes-http'
import { usePersonalLibraryOrganizationWorkflow } from './personal-library-organization-workflow'
import { usePersonalLibraryPreferenceWorkflow } from './personal-library-preference-workflow'
import { usePersonalLibraryVisitWorkflow } from './personal-library-visit-workflow'
import { BrowserVisitProblem } from './personal-library-visits-http'

type LibrarySurface =
  | Readonly<{ kind: 'state'; state: LibraryPlaceState }>
  | Readonly<{ kind: 'collection'; collectionId: string }>

export function usePersonalLibraryWorkflow() {
  const [mode, setMode] = useState<'browse' | 'manage'>('browse')
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
  const [selectedDetail, setSelectedDetail] = useState<PlaceDetailResponse | undefined>()
  const [collectionName, setCollectionName] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [metadataLoading, setMetadataLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [authenticationRequired, setAuthenticationRequired] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const requestSequence = useRef(0)
  const detailSequence = useRef(0)

  const handleFailure = useCallback((reason: unknown) => {
    if (reason instanceof DOMException && reason.name === 'AbortError') return
    const status = reason instanceof BrowserLibraryProblem ||
      reason instanceof BrowserVisitProblem || reason instanceof BrowserWritingProblem
      ? reason.status
      : undefined
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

  const loadSelectedDetail = useCallback(async (
    placeId: string,
    signal?: AbortSignal,
    background = false,
  ) => {
    const sequence = ++detailSequence.current
    if (!background) {
      setSelectedDetail(undefined)
      setDetailLoading(true)
    }
    try {
      const value = await personalLibraryHttp.place(placeId, signal)
      if (sequence === detailSequence.current) setSelectedDetail(value)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (sequence === detailSequence.current && !background) setSelectedDetail(undefined)
      throw reason
    } finally {
      if (sequence === detailSequence.current && !background) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    setSelectedDetail(undefined)
    if (selectedPlaceId === undefined) return
    const controller = new AbortController()
    void loadSelectedDetail(selectedPlaceId, controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [loadSelectedDetail, selectedPlaceId])

  const selectedRow = rows.find((row) => row.placeId === selectedPlaceId)

  function chooseState(state: LibraryPlaceState) {
    setSurface({ kind: 'state', state })
  }

  function chooseCollection(collectionId: string) {
    setSelectedTagIds([])
    setTagMatch('all')
    setSelectedAreaKeys([])
    setSelectedTaxonomyKeys([])
    setSurface({ kind: 'collection', collectionId })
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => (
      current.includes(tagId)
        ? current.filter((candidate) => candidate !== tagId)
        : [...current, tagId]
    ))
    setSurface((current) => current.kind === 'state' ? current : { kind: 'state', state: 'saved' })
  }

  function toggleArea(areaKey: string) {
    setSelectedAreaKeys((current) => (
      current.includes(areaKey)
        ? current.filter((candidate) => candidate !== areaKey)
        : current.length >= 10 ? current : [...current, areaKey]
    ))
    setSurface((current) => current.kind === 'state' ? current : { kind: 'state', state: 'saved' })
  }

  function toggleTaxonomy(taxonomyKey: string) {
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

  const organization = usePersonalLibraryOrganizationWorkflow({
    selectedPlaceId,
    onAccessFailure: handleFailure,
    refreshLibrary,
  })
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
  const refreshSelectedPlace = useCallback(() => selectedPlaceId === undefined
    ? Promise.resolve()
    : loadSelectedDetail(selectedPlaceId, undefined, true), [loadSelectedDetail, selectedPlaceId])
  const preferences = usePersonalLibraryPreferenceWorkflow({
    selectedPlaceId,
    personalState: selectedDetail?.personalState,
    onAccessFailure: handleFailure,
    refreshLibrary,
    refreshPlace: refreshSelectedPlace,
  })
  const visitWorkflow = usePersonalLibraryVisitWorkflow({
    active: mode === 'browse',
    selectedPlaceId,
    summary: selectedDetail?.personalState?.visits,
    onAccessFailure: handleFailure,
    refreshPlace: refreshSelectedPlace,
  })
  const noteWorkflow = usePersonalLibraryNoteWorkflow({
    active: mode === 'browse',
    selectedPlaceId,
    onAccessFailure: handleFailure,
  })
  const { refreshSelectedOrganization, ...organizationView } = organization

  return {
    mode,
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
    selectedDetail,
    ...managementWorkflow,
    ...preferences,
    ...visitWorkflow,
    ...noteWorkflow,
    ...organizationView,
    collectionName,
    loading,
    loadingMore,
    metadataLoading,
    detailLoading,
    authenticationRequired,
    error,
    showBrowse: () => {
      setMode('browse')
      void Promise.all([
        refreshLibrary(),
        refreshSelectedOrganization(),
      ]).catch(handleFailure)
    },
    showManagement: () => setMode('manage'),
    chooseState,
    chooseCollection,
    toggleTag,
    toggleArea,
    toggleTaxonomy,
    setTagMatch,
    selectPlace: setSelectedPlaceId,
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
