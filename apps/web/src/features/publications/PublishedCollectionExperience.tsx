'use client'

import type {
  PublishedCollection,
  PublishedCollectionMap,
} from '@place/contracts/http'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  PlaceMapCluster,
  PlaceMapRenderer,
  PlaceMapViewport,
} from '@/platform/maps/place-map-interface'
import { publishedCollectionHttp } from '@/platform/publications/published-collection-http'

import { PublishedCollectionActions } from './PublishedCollectionActions'
import { PublishedCollectionPlaces } from './PublishedCollectionPlaces'
import { PublishedPlaceDetail } from './PublishedPlaceDetail'
import styles from './publication.module.css'

function initialViewport(collection: PublishedCollection): PlaceMapViewport {
  const locations = collection.places.flatMap((item) => (
    item.place === null ? [] : [item.place.location]
  ))
  if (locations.length === 0) {
    return { bounds: { west: -180, south: -85, east: 180, north: 85 }, zoom: 2 }
  }
  const longitudes = locations.map((location) => location.longitude)
  const latitudes = locations.map((location) => location.latitude)
  const west = Math.min(...longitudes)
  const east = Math.max(...longitudes)
  const south = Math.min(...latitudes)
  const north = Math.max(...latitudes)
  const longitudePadding = Math.max((east - west) * 0.15, 0.01)
  const latitudePadding = Math.max((north - south) * 0.15, 0.01)
  const span = Math.max(east - west, north - south)
  const zoom = span > 40 ? 2
    : span > 10 ? 4
      : span > 2 ? 6
        : span > 0.5 ? 8
          : span > 0.1 ? 10
            : span > 0.02 ? 12 : 14
  return {
    bounds: {
      west: Math.max(-180, west - longitudePadding),
      south: Math.max(-90, south - latitudePadding),
      east: Math.min(180, east + longitudePadding),
      north: Math.min(90, north + latitudePadding),
    },
    zoom,
  }
}

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
  const [viewport, setViewport] = useState(() => initialViewport(initialCollection))
  const [projection, setProjection] = useState<PublishedCollectionMap>()
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState<string>()
  const [mapRevision, setMapRevision] = useState(0)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>()
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

  return (
    <>
      <PublishedCollectionActions
        name={initialCollection.name}
        publicationId={initialCollection.publicationId}
      />
      <section aria-label="공유 컬렉션 지도" className={styles.mapSection}>
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
          onSelect={setSelectedPlaceId}
          onViewportChange={setViewport}
          selectedMarkerId={selectedPlaceId}
          title={`공유 장소 ${represented}개`}
          zoom={viewport.zoom}
        />
      </section>
      {selectedPlaceId !== undefined && (
        <PublishedPlaceDetail
          onClose={() => setSelectedPlaceId(undefined)}
          placeId={selectedPlaceId}
        />
      )}
      <p className={styles.count}>
        전체 {initialCollection.placeCount}개 · {places.length}개 불러옴
      </p>
      <PublishedCollectionPlaces
        onSelect={setSelectedPlaceId}
        places={places}
        selectedPlaceId={selectedPlaceId}
      />
      {nextCursor !== undefined && (
        <div className={styles.loadMore} ref={sentinel}>
          <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
            {loadingMore ? '불러오는 중…' : '장소 더 보기'}
          </button>
        </div>
      )}
      {listError !== undefined && <p className={styles.listError} role="alert">{listError}</p>}
    </>
  )
}
