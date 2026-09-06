'use client'

import type {
  PersonalLibraryMapResponseV3,
  LibraryTagListResponse,
  PersonalLibraryRatingFilterV2,
  PersonalLibraryWorkspaceResponseV2,
} from '@place/contracts/library'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  CollectionLibraryProblem,
  collectionLibraryHttp,
} from './collection-library-http'
import { usePlaceFilingWorkflow } from '../place-filing/place-filing-workflow'
import { createLibraryMapRequestGuard } from '../library-map/library-map-request-guard'
import { useCollectionDirectory } from './collection-directory-workflow'
import { useLibraryQuery } from './search/use-library-query'

type PageStatus = 'loading' | 'ready' | 'authentication-required' | 'forbidden' | 'not-found' | 'unavailable' | 'error'
type MobileSurface = 'collections' | 'list' | 'map' | 'detail'

const initialViewport: PersonalLibraryMapResponseV3['viewport'] = {
  bounds: { west: 126.90, south: 37.50, east: 127.10, north: 37.60 },
  zoom: 12,
}

function failureStatus(reason: unknown): PageStatus {
  const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
  if (status === 401) return 'authentication-required'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 503) return 'unavailable'
  return 'error'
}

export type LibraryInitialScope = Readonly<{ initialQuery?: string; initialCollectionId?: string; initialScope?: 'directory' | 'favorites' }>

export function useCollectionLibraryWorkflow(initial: LibraryInitialScope = {}) {
  const [pageStatus, setPageStatus] = useState<PageStatus>('loading')
  const [workspace, setWorkspace] = useState<PersonalLibraryWorkspaceResponseV2 | undefined>()
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | undefined>(initial.initialCollectionId)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | undefined>()
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>(initial.initialCollectionId !== undefined || initial.initialQuery !== undefined || initial.initialScope === 'favorites' ? 'list' : 'collections')
  const [collectionQuery, setCollectionQuery] = useState('')
  const [ratingFilter, setRatingFilter] = useState<PersonalLibraryRatingFilterV2['kind']>('any')
  const [tagIds, setTagIds] = useState<readonly string[]>([])
  const [areaKeys, setAreaKeys] = useState<readonly string[]>([])
  const [taxonomyKeys, setTaxonomyKeys] = useState<readonly string[]>([])
  const [tags, setTags] = useState<LibraryTagListResponse['items']>([])
  const [tagError, setTagError] = useState(false)
  const [tagNextCursor, setTagNextCursor] = useState<string | undefined>()
  const [loadingMoreTags, setLoadingMoreTags] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [revision, setRevision] = useState(0)
  const [mapViewport, setMapViewport] = useState(initialViewport)
  const [mapProjection, setMapProjection] = useState<PersonalLibraryMapResponseV3 | undefined>()
  const [mapStatus, setMapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [collectionMutation, setCollectionMutation] = useState<'idle' | 'creating' | 'renaming' | 'deleting'>('idle')
  const [collectionMessage, setCollectionMessage] = useState<string | undefined>()
  const requestSequence = useRef(0)
  const mapRequests = useRef(createLibraryMapRequestGuard())
  const tagRequestSequence = useRef(0)
  const tagController = useRef<AbortController | undefined>(undefined)

  const accessFailure = useCallback((status: number) => {
    setPageStatus(status === 401 ? 'authentication-required' : 'forbidden')
  }, [])
  const directoryFailure = useCallback((reason: unknown) => setPageStatus(failureStatus(reason)), [])
  const directory = useCollectionDirectory(collectionQuery, revision, directoryFailure)
  const search = useLibraryQuery(initial.initialQuery ?? '', [
    ...(workspace?.availableFilters.areas.map((item) => ({ kind: 'area' as const, key: item.key, label: item.label })) ?? []),
    ...(workspace?.availableFilters.taxonomies.map((item) => ({ kind: 'taxonomy' as const, key: item.key, label: item.label })) ?? []),
    ...tags.map((item) => ({ kind: 'tag' as const, key: item.tagId, label: item.name })),
  ], { areaKeys, taxonomyKeys, tagIds })
  const { query: placeQuery, submit: setPlaceQuery, text: queryText, filters: queryFilters } = search
  const hasPlaceScope = mobileSurface !== 'collections'

  const loadWorkspace = useCallback(async (
    cursors: Readonly<{ placeCursor?: string }> = {},
    append?: 'places',
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    if (append === 'places') setLoadingMore(true)
    else setPageStatus('loading')
    try {
      const next = await collectionLibraryHttp.workspace({
        favoriteScope: selectedCollectionId === undefined
          ? { kind: 'all' }
          : { kind: 'collection', collectionId: selectedCollectionId },
        ...(selectedCollectionId === undefined ? {} : { includeSelectedCollection: true }),
        ratingFilter: { kind: ratingFilter },
        tagIds: [...queryFilters.tagIds],
        tagMatch: 'all',
        areaKeys: [...queryFilters.areaKeys],
        taxonomyKeys: [...queryFilters.taxonomyKeys],
        ...(queryText ? { placeQuery: queryText } : {}),
        ...(cursors.placeCursor === undefined ? {} : { placeCursor: cursors.placeCursor }),
        limit: 20,
      }, signal)
      if (sequence !== requestSequence.current) return
      setWorkspace((current) => {
        if (current === undefined || append === undefined) return next
        return {
          ...next,
          collections: current.collections,
          collectionNextCursor: current.collectionNextCursor,
          places: [...current.places, ...next.places.filter((candidate) => (
            !current.places.some((existing) => existing.placeId === candidate.placeId)
          ))],
        }
      })
      setPageStatus('ready')
    } catch (reason) {
      if (
        sequence !== requestSequence.current ||
        (reason instanceof DOMException && reason.name === 'AbortError')
      ) return
      if (!append) setWorkspace(undefined)
      setPageStatus(failureStatus(reason))
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false)
    }
  }, [queryFilters, queryText, ratingFilter, selectedCollectionId])

  useEffect(() => {
    const controller = new AbortController()
    void loadWorkspace({}, undefined, controller.signal)
    return () => controller.abort()
  }, [loadWorkspace, revision])

  const selectedCollection = (workspace?.selectedCollection?.collectionId === selectedCollectionId
    ? workspace?.selectedCollection : undefined) ?? workspace?.collections.find((collection) => (
    collection.collectionId === selectedCollectionId
  )) ?? directory.collections.find((collection) => collection.collectionId === selectedCollectionId)

  useEffect(() => {
    const controller = new AbortController()
    tagController.current?.abort()
    tagController.current = controller
    const sequence = ++tagRequestSequence.current
    setLoadingMoreTags(false)
    collectionLibraryHttp.tags(controller.signal).then((page) => {
      if (sequence !== tagRequestSequence.current) return
      setTags(page.items)
      setTagNextCursor(page.nextCursor)
      setTagError(false)
    }).catch((reason) => {
        if (sequence !== tagRequestSequence.current) return
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
        if (status === 401 || status === 403) accessFailure(status)
        setTagError(true)
    })
    return () => { tagRequestSequence.current += 1; tagController.current?.abort() }
  }, [accessFailure, revision])

  useEffect(() => {
    setMapProjection(undefined)
    if (!hasPlaceScope) {
      mapRequests.current.invalidate()
      setMapStatus('idle')
      return
    }
    const request = mapRequests.current.start()
    const timeout = window.setTimeout(() => {
      setMapStatus('loading')
      collectionLibraryHttp.map({
        ...(selectedPlaceId === undefined ? {} : { selectedPlaceId }),
        favoriteScope: selectedCollectionId === undefined ? { kind: 'all' } : { kind: 'collection', collectionId: selectedCollectionId },
        ratingFilter: { kind: ratingFilter },
        tagIds: [...queryFilters.tagIds], tagMatch: 'all', areaKeys: [...queryFilters.areaKeys], taxonomyKeys: [...queryFilters.taxonomyKeys],
        ...(queryText ? { placeQuery: queryText } : {}),
        west: mapViewport.bounds.west,
        south: mapViewport.bounds.south,
        east: mapViewport.bounds.east,
        north: mapViewport.bounds.north,
        zoom: mapViewport.zoom,
      }, request.signal).then((projection) => {
        if (!mapRequests.current.isCurrent(request)) return
        setMapProjection(projection)
        setMapStatus('ready')
      }).catch((reason) => {
        if (!mapRequests.current.isCurrent(request)) return
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
        if (status === 401 || status === 403) accessFailure(status)
        setMapStatus('error')
      })
    }, 150)
    return () => {
      window.clearTimeout(timeout)
      mapRequests.current.cancel(request)
    }
  }, [accessFailure, hasPlaceScope, mapViewport, queryFilters, queryText, ratingFilter, revision, selectedCollectionId, selectedPlaceId])

  const refresh = useCallback(async () => {
    setRevision((current) => current + 1)
  }, [])

  const handleTagsChanged = useCallback(async (deletedTagId?: string) => {
    if (deletedTagId !== undefined) {
      setTagIds((current) => current.filter((tagId) => tagId !== deletedTagId))
    }
    setRevision((current) => current + 1)
  }, [])

  const filing = usePlaceFilingWorkflow(selectedPlaceId, refresh, accessFailure)

  const taxonomyOptions = useMemo(() => {
    return workspace?.availableFilters.taxonomies.map((facet) => ({
      key: facet.key,
      label: facet.label,
    })) ?? []
  }, [workspace])

  const executeCollectionCommand = useCallback(async (
    kind: 'creating' | 'renaming' | 'deleting',
    request: Parameters<typeof collectionLibraryHttp.collectionCommand>[0],
    onApplied: () => void,
  ) => {
    if (collectionMutation !== 'idle') return false
    setCollectionMutation(kind)
    setCollectionMessage(undefined)
    try {
      const result = await collectionLibraryHttp.collectionCommand(request)
      if (result.outcome === 'rejected') {
        setCollectionMessage(result.rejection.code === 'not-found'
          ? '이 카테고리는 더 이상 존재하지 않습니다.'
          : result.rejection.code === 'version-conflict'
            ? '다른 곳에서 카테고리가 변경되었습니다. 최신 목록에서 다시 시도해 주세요.'
            : '카테고리 변경을 적용할 수 없습니다. 최신 목록을 확인해 주세요.')
        setRevision((current) => current + 1)
        return false
      }
      onApplied()
      setRevision((current) => current + 1)
      return true
    } catch (reason) {
      const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
      if (status === 401 || status === 403) accessFailure(status)
      setCollectionMessage(status === 404
        ? '이 카테고리는 더 이상 존재하지 않습니다.'
        : status === 409
          ? '다른 곳에서 카테고리가 변경되었습니다. 최신 목록에서 다시 시도해 주세요.'
          : status === 503
            ? '카테고리 변경을 저장할 수 없습니다. 잠시 뒤 다시 시도해 주세요.'
            : '카테고리 변경을 적용하지 못했습니다.')
      return false
    } finally {
      setCollectionMutation('idle')
    }
  }, [accessFailure, collectionMutation])

  const createCollection = () => {
    const name = newCollectionName.trim()
    if (name.length === 0 || name.length > 120) return Promise.resolve()
    const collectionId = crypto.randomUUID()
    return executeCollectionCommand('creating', {
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'create',
      commandId: crypto.randomUUID(),
      collectionId,
      name,
      description: null,
    }, () => {
      setNewCollectionName('')
      setCollectionQuery('')
      setSelectedCollectionId(collectionId)
      setMobileSurface('list')
    })
  }

  const renameCollection = (target: NonNullable<typeof selectedCollection>, draft: string) => {
    const name = draft.trim()
    if (
      name.length === 0 || name.length > 120 ||
      name === target.name
    ) return Promise.resolve(false)
    return executeCollectionCommand('renaming', {
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'update',
      commandId: crypto.randomUUID(),
      collectionId: target.collectionId,
      expectedCollectionRevision: target.collectionRevision,
      name,
    }, () => undefined)
  }

  const deleteCollection = (target: NonNullable<typeof selectedCollection>) => {
    return executeCollectionCommand('deleting', {
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'delete',
      commandId: crypto.randomUUID(),
      collectionId: target.collectionId,
      expectedCollectionRevision: target.collectionRevision,
    }, () => {
      if (selectedCollectionId === target.collectionId) {
        setSelectedCollectionId(undefined)
        setSelectedPlaceId(undefined)
        setMobileSurface('collections')
      }
    })
  }

  const selectedPlace = workspace?.places.find((row) => row.placeId === selectedPlaceId)

  return {
    pageStatus: directory.error === undefined ? pageStatus : failureStatus(directory.error),
    workspace,
    collections: directory.collections,
    collectionNextCursor: directory.nextCursor,
    loadingCollections: directory.loading,
    selectedCollectionId,
    selectedCollection,
    selectedPlaceId,
    selectedPlace,
    mobileSurface,
    collectionQuery,
    placeQuery,
    search,
    setCollectionQuery,
    setPlaceQuery,
    ratingFilter,
    tagIds: queryFilters.tagIds,
    areaKeys: queryFilters.areaKeys,
    taxonomyKeys: queryFilters.taxonomyKeys,
    tags,
    tagError,
    tagNextCursor,
    loadingMoreTags,
    availableFilters: workspace?.availableFilters,
    taxonomyOptions,
    loadingMore,
    loadingMoreCollections: directory.loadingMore,
    mapViewport,
    mapProjection,
    mapStatus,
    newCollectionName,
    collectionMutation,
    collectionMessage,
    filing,
    handleAccessFailure: accessFailure,
    handleTagsChanged,
    selectCollection: (collectionId: string) => {
      if (selectedCollectionId !== collectionId) {
        setPlaceQuery('')
        setRatingFilter('any')
        setTagIds([])
        setAreaKeys([])
        setTaxonomyKeys([])
      }
      setSelectedCollectionId(collectionId)
      setSelectedPlaceId(undefined)
      setMobileSurface('list')
    },
    selectPlace: (placeId: string) => {
      setSelectedPlaceId(placeId)
      setMobileSurface('detail')
    },
    selectAllPlaces: () => {
      if (selectedCollectionId !== undefined) {
        setPlaceQuery(''); setRatingFilter('any'); setTagIds([]); setAreaKeys([]); setTaxonomyKeys([])
      }
      setSelectedCollectionId(undefined)
      setSelectedPlaceId(undefined)
      setMobileSurface('list')
    },
    closeDetail: () => {
      setSelectedPlaceId(undefined)
      setMobileSurface('list')
    },
    showMobileSurface: setMobileSurface,
    showCollections: () => {
      setSelectedPlaceId(undefined)
      setMobileSurface('collections')
    },
    clearFilters: () => {
      search.clearConditions()
      setRatingFilter('any')
      setTagIds([])
      setAreaKeys([])
      setTaxonomyKeys([])
    },
    setRatingFilter,
    toggleTag: (tagId: string) => {
      const automatic = search.conditions.find((item) => item.kind === 'tag' && item.key === tagId)
      if (automatic) search.removeCondition(automatic)
      setTagIds((current) => current.includes(tagId) ? current.filter((candidate) => candidate !== tagId) : automatic ? current : [...current, tagId])
    },
    toggleArea: (key: string) => {
      const automatic = search.conditions.find((item) => item.kind === 'area' && item.key === key)
      if (automatic) search.removeCondition(automatic)
      setAreaKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : automatic ? current : [...current, key])
    },
    toggleTaxonomy: (key: string) => {
      const automatic = search.conditions.find((item) => item.kind === 'taxonomy' && item.key === key)
      if (automatic) search.removeCondition(automatic)
      setTaxonomyKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : automatic ? current : [...current, key])
    },
    setMapViewport,
    retryMap: () => setRevision((current) => current + 1),
    retry: () => setRevision((current) => current + 1),
    recoverMissingCollection: () => {
      setSelectedCollectionId(undefined)
      setSelectedPlaceId(undefined)
      setMobileSurface('collections')
      setRevision((current) => current + 1)
    },
    loadMore: () => workspace?.placeNextCursor === undefined
      ? undefined
      : loadWorkspace({ placeCursor: workspace.placeNextCursor }, 'places'),
    loadMoreCollections: directory.loadMore,
    loadMoreTags: async () => {
      if (tagNextCursor === undefined || loadingMoreTags) return
      setLoadingMoreTags(true)
      tagController.current?.abort()
      const controller = new AbortController()
      tagController.current = controller
      const sequence = ++tagRequestSequence.current
      try {
        const page = await collectionLibraryHttp.tags(controller.signal, tagNextCursor)
        if (sequence !== tagRequestSequence.current) return
        setTags((current) => [...current, ...page.items.filter((tag) => !current.some((item) => item.tagId === tag.tagId))])
        setTagNextCursor(page.nextCursor)
        setTagError(false)
      } catch (reason) {
        if (sequence !== tagRequestSequence.current || (reason instanceof DOMException && reason.name === 'AbortError')) return
        const status = reason instanceof CollectionLibraryProblem ? reason.status : 503
        if (status === 401 || status === 403) accessFailure(status)
        setTagError(true)
      } finally { if (sequence === tagRequestSequence.current) setLoadingMoreTags(false) }
    },
    setNewCollectionName,
    createCollection,
    renameCollection,
    deleteCollection,
    refresh,
  }
}

export type CollectionLibraryWorkflow = ReturnType<typeof useCollectionLibraryWorkflow>
