'use client'

import type {
  PersonalLibraryMapRequestV4,
  PersonalLibraryMapResponseV4,
  PersonalLibraryMapSelectionV4,
} from '@place/contracts/library'
import { useCallback, useEffect, useState } from 'react'

import type { PlaceMapViewport } from '../../platform/maps/public'

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
  readMap: (
    query: PersonalLibraryMapRequestV4,
    signal: AbortSignal,
  ) => Promise<
    | Readonly<{ kind: 'ready'; projection: PersonalLibraryMapResponseV4 }>
    | Readonly<{ kind: 'signed-out' | 'unavailable' }>
  >
}>

export type MapCollectionSelection = PersonalLibraryMapSelectionV4 | Readonly<{ kind: 'none' }>
export type CatalogLibraryState = 'loading' | 'ready' | 'signed-out' | 'unavailable'

export function useCatalogLibraryOverlay({
  library,
  selectedPlaceId,
  viewport,
}: Readonly<{
  library: CatalogHomeLibrary
  selectedPlaceId: string | undefined
  viewport: PlaceMapViewport
}>) {
  const [collections, setCollections] = useState<readonly FavoriteCollection[]>([])
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false)
  const [collectionState, setCollectionState] = useState<CatalogLibraryState>('loading')
  const [selection, setSelection] = useState<MapCollectionSelection>({ kind: 'none' })
  const [projection, setProjection] = useState<PersonalLibraryMapResponseV4>()
  const [metadata, setMetadata] = useState<PersonalLibraryMapResponseV4['selectedCollections']>([])
  const [mapState, setMapState] = useState<CatalogLibraryState>('loading')
  const [revision, setRevision] = useState(0)

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

  useEffect(() => {
    const controller = new AbortController()
    setMapState('loading')
    void (async () => {
      try {
        const result = await library.readMap({
          selection: selection.kind === 'none' ? { kind: 'all' } : selection,
          ratingFilter: { kind: 'any' },
          tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
          ...(selectedPlaceId === undefined ? {} : { selectedPlaceId }),
          west: viewport.bounds.west, south: viewport.bounds.south,
          east: viewport.bounds.east, north: viewport.bounds.north, zoom: viewport.zoom,
        }, controller.signal)
        if (controller.signal.aborted) return
        if (result.kind !== 'ready') {
          setProjection(undefined)
          setMapState(result.kind)
          return
        }
        setProjection(result.projection)
        setMetadata((current) => {
          const byId = new Map(current.map((collection) => [collection.collectionId, collection]))
          for (const collection of result.projection.selectedCollections) byId.set(collection.collectionId, collection)
          return [...byId.values()]
        })
        setMapState('ready')
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (!controller.signal.aborted) {
          setProjection(undefined)
          setMapState('unavailable')
        }
      }
    })()
    return () => controller.abort()
  }, [library, revision, selectedPlaceId, selection, viewport])

  const refresh = useCallback(async () => {
    await loadCollections(new AbortController().signal)
    setRevision((current) => current + 1)
  }, [loadCollections])

  return {
    collections,
    collectionState,
    collectionPickerOpen,
    selection,
    projection,
    metadata,
    mapState,
    setCollectionPickerOpen,
    clear: () => setSelection({ kind: 'none' }),
    selectAll: () => setSelection({ kind: 'all' }),
    toggle: (collectionId: string) => setSelection((current) => {
      if (current.kind === 'none') return { kind: 'collections', collectionIds: [collectionId] }
      if (current.kind === 'all') {
        const available = metadata.length > 0 ? metadata : collections
        const collectionIds = available.map((collection) => collection.collectionId)
          .filter((candidate) => candidate !== collectionId)
        return collectionIds.length === 0 ? { kind: 'none' } : { kind: 'collections', collectionIds }
      }
      const collectionIds = current.collectionIds.includes(collectionId)
        ? current.collectionIds.filter((candidate) => candidate !== collectionId)
        : [...current.collectionIds, collectionId]
      return collectionIds.length === 0 ? { kind: 'none' } : { kind: 'collections', collectionIds }
    }),
    refresh,
    recordAccessFailure: (status: number) => setCollectionState(status === 401 ? 'signed-out' : 'unavailable'),
  }
}
