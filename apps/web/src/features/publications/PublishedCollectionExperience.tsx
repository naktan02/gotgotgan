'use client'

import type {
  PublishedCollection,
  PublishedCollectionMap,
} from '@place/contracts/http'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  PlaceMapCluster,
  PlaceMapRenderer,
} from '@/platform/maps/public'
import { publishedCollectionHttp } from '@/platform/publications/published-collection-http'

import { PublishedCollectionActions } from './PublishedCollectionActions'
import { PublishedCollectionPlaces } from './PublishedCollectionPlaces'
import { PublishedPlaceDetail } from './PublishedPlaceDetail'
import { createPublishedMapInitialViewport } from './published-map-initial-viewport'
import styles from './publication.module.css'

export function PublishedCollectionExperience({
  initialCollection,
  mapRenderer: MapRenderer,
}: Readonly<{
  initialCollection: PublishedCollection
  mapRenderer: PlaceMapRenderer
}>) {
  const [places, setPlaces] = useState(initialCollection.places)
  const [nextCursor, setNextCursor] = useState(initialCollection.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [listError, setListError] = useState<string>()
  const [viewport, setViewport] = useState(() => createPublishedMapInitialViewport(
    initialCollection.places.flatMap((item) => (
      item.place?.location == null ? [] : [item.place.location]
    )),
  ))
  const [projection, setProjection] = useState<PublishedCollectionMap>()
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState<string>()
  const [mapRevision, setMapRevision] = useState(0)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>()
  const [collapsed, setCollapsed] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const listPanel = useRef<HTMLDivElement>(null)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const listScroll = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
  const listLoading = useRef(false)
  const listRequest = useRef(0)
  const mapRequest = useRef(0)

  const loadMore = useCallback(async () => {
    if (nextCursor === undefined || listLoading.current) return
    listLoading.current = true
    const sequence = ++listRequest.current
    setLoadingMore(true)
    setListError(undefined)
    try {
      const page = await publishedCollectionHttp.page(
        initialCollection.publicationId,
        nextCursor,
      )
      if (sequence !== listRequest.current) return
      if (page.updatedAt !== initialCollection.updatedAt) {
        throw new Error('Published Collection changed while paging')
      }
      setPlaces((current) => {
        const merged = new Map(current.map((place) => [place.placeId, place]))
        for (const place of page.places) merged.set(place.placeId, place)
        return [...merged.values()].sort((left, right) => (
          left.position - right.position || left.placeId.localeCompare(right.placeId)
        ))
      })
      setNextCursor(page.nextCursor)
    } catch {
      if (sequence === listRequest.current) {
        setListError('장소 목록을 더 불러오지 못했습니다.')
      }
    } finally {
      if (sequence === listRequest.current) {
        listLoading.current = false
        setLoadingMore(false)
      }
    }
  }, [initialCollection.publicationId, initialCollection.updatedAt, nextCursor])

  useEffect(() => {
    if (nextCursor === undefined || sentinel.current === null) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '240px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [loadMore, nextCursor])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      const sequence = ++mapRequest.current
      setMapLoading(true)
      setMapError(undefined)
      void publishedCollectionHttp.map(initialCollection.publicationId, {
        ...viewport.bounds,
        zoom: viewport.zoom,
      }, controller.signal).then((map) => {
        if (sequence === mapRequest.current) setProjection(map)
      }).catch((error: unknown) => {
        if (sequence === mapRequest.current
          && !(error instanceof DOMException && error.name === 'AbortError')) {
          setMapError('현재 지도 영역을 불러오지 못했습니다.')
        }
      }).finally(() => {
        if (sequence === mapRequest.current && !controller.signal.aborted) {
          setMapLoading(false)
        }
      })
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [initialCollection.publicationId, mapRevision, viewport])

  const markers = projection?.features.flatMap((feature) => feature.kind === 'place' ? [{
    id: feature.placeId,
    label: feature.label,
    location: feature.location,
  }] : []) ?? []
  const clusters: readonly PlaceMapCluster[] = projection?.features.flatMap((feature) => (
    feature.kind === 'cluster' ? [{
      id: feature.clusterId,
      count: feature.count,
      location: feature.location,
      bounds: feature.bounds,
    }] : []
  )) ?? []
  const represented = projection?.coverage.representedPlaceCount ?? 0
  const unprojected = projection?.coverage.unprojectedPlaceCount ?? 0
  const mapDescription = mapError ?? (mapLoading
    ? '현재 지도 영역의 공유 장소를 불러오는 중입니다.'
    : `현재 지도 영역의 공유 장소 ${represented}개를 표현했습니다.${
      unprojected > 0 ? ` 위치 준비 중인 장소는 ${unprojected}개입니다.` : ''
    }`)

  const selectPlace = (placeId: string) => {
    if (selectedPlaceId === undefined) {
      listScroll.current = listPanel.current?.scrollTop ?? 0
      selectedButton.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    }
    setSelectedPlaceId(placeId)
    setCollapsed(false)
    window.requestAnimationFrame(() => panel.current?.focus())
  }
  const returnToList = () => {
    setSelectedPlaceId(undefined)
    window.requestAnimationFrame(() => {
      if (listPanel.current !== null) listPanel.current.scrollTop = listScroll.current
      selectedButton.current?.focus({ preventScroll: true })
    })
  }

  return (
    <section aria-label="공유 목록 작업 공간" className={styles.collectionWorkspace} data-collapsed={collapsed}>
      <div className={styles.collectionPanel} hidden={collapsed} id="published-collection-panel" ref={panel} tabIndex={-1}>
      <div className={styles.collectionDirectory} hidden={selectedPlaceId !== undefined} ref={listPanel}>
      <header className={styles.collectionHeader}>
        <p>공유 목록 · 장소 {initialCollection.placeCount}곳</p>
        <h1>{initialCollection.name}</h1>
        {initialCollection.description && <details><summary>목록 소개</summary><p>{initialCollection.description}</p></details>}
      </header>
      <PublishedCollectionActions
        name={initialCollection.name}
        publicationId={initialCollection.publicationId}
      />
      <p className={styles.count}>
        전체 {initialCollection.placeCount}개 · {places.length}개 불러옴
      </p>
      <PublishedCollectionPlaces onSelect={selectPlace} places={places} selectedPlaceId={selectedPlaceId} />
      {nextCursor !== undefined && (
        <div className={styles.loadMore} ref={sentinel}>
          <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
            {loadingMore ? '불러오는 중…' : '장소 더 보기'}
          </button>
        </div>
      )}
      {listError !== undefined && <p className={styles.listError} role="alert">{listError}</p>}
      </div>
      {selectedPlaceId !== undefined && <PublishedPlaceDetail onClose={returnToList} placeId={selectedPlaceId} />}
      </div>
      <button aria-controls="published-collection-panel" aria-expanded={!collapsed} aria-label={collapsed ? '공유 목록 패널 펼치기' : '공유 목록 패널 접기'} className={styles.panelToggle} onClick={() => setCollapsed(!collapsed)} type="button">{collapsed ? '목록 ›' : '‹ 접기'}</button>
      <div className={styles.mapSection}>
        <MapRenderer
          ariaLabel="공유 컬렉션 지도"
          bounds={viewport.bounds}
          clusters={clusters}
          description={mapDescription}
          markers={markers}
          onClusterSelect={(cluster) => setViewport({
            bounds: cluster.bounds,
            zoom: Math.min(22, viewport.zoom + 2),
          })}
          onMove={mapError === undefined ? undefined : () => setMapRevision((value) => value + 1)}
          onSelect={selectPlace}
          onViewportChange={setViewport}
          selectedMarkerId={selectedPlaceId}
          title={`공유 장소 ${represented}개`}
          zoom={viewport.zoom}
        />
      </div>
    </section>
  )
}
