'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  Marker as MapLibreMarker,
} from 'maplibre-gl'

import type { PlaceMapCluster, PlaceMapRendererProperties, PlaceMapViewport } from '../place-map-interface'
import { rewriteOpenFreeMapSourceRequest } from '../openfreemap-source/source-location'
import { replaceAccessibleMarkers } from './accessible-place-markers'
import { configureGlobeAppearance } from './appearance/globe-appearance'
import { configureTransitAppearance } from './appearance/transit-appearance'
import { CoincidentPlaceChoices, MapPresentationControls } from './MapPresentationControls'
import type { MapMarkerMode } from './marker-presentation'
import { readInitialCameraLocation } from './initial-camera-location'
import { localizePlaceMapNames } from './map-label-language'
import { configurePlaceMapProjection } from './map-projection'
import { centerForBounds, readMapViewport } from './map-viewport'
import {
  CLUSTER_LAYER_ID,
  createPlaceFeatureCollection,
  installPlaceSource,
  PLACE_LAYER_ID,
  updatePlaceSource,
} from './place-map-source'
import { readBrowserPlaceMapStyleUrl } from './map-style-config'
import styles from './maplibre-place-map.module.css'

type MapLibreModule = typeof import('maplibre-gl')

export function MapLibrePlaceMap({
  ariaLabel = '장소 지도',
  bounds,
  clusters = [],
  description = '곳곳간 장소를 지도에 표시했습니다.',
  initialCameraMode = 'supplied-bounds',
  markers,
  moveLabel = '지도 다시 불러오기',
  selectedMarkerId,
  zoom = 12,
  onClusterSelect,
  onMove,
  onSelect,
  onViewportChange,
  onOpenPlaceList,
}: PlaceMapRendererProperties) {
  const containerRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLParagraphElement>(null)
  const mapRef = useRef<MapLibreMap | undefined>(undefined)
  const moduleRef = useRef<MapLibreModule | undefined>(undefined)
  const accessibleMarkersRef = useRef<readonly MapLibreMarker[]>([])
  const callbacksRef = useRef({ onClusterSelect, onSelect, onViewportChange })
  const featuresRef = useRef({ clusters, markers, selectedMarkerId })
  const initialCameraModeRef = useRef(initialCameraMode)
  const reportedViewportRef = useRef<PlaceMapViewport | undefined>(undefined)
  const synchronizingRef = useRef<Readonly<{ center: readonly [number, number]; zoom: number }> | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [markerMode, setMarkerMode] = useState<MapMarkerMode>('category')
  const [activeCluster, setActiveCluster] = useState<PlaceMapCluster | undefined>()

  callbacksRef.current = { onClusterSelect: (cluster) => {
    if (cluster.coincidentPreview != null) setActiveCluster(cluster)
    else onClusterSelect?.(cluster)
  }, onSelect, onViewportChange }
  featuresRef.current = { clusters, markers, selectedMarkerId }
  initialCameraModeRef.current = initialCameraMode

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    let cancelled = false
    let loaded = false
    setState('loading')
    const deadline = window.setTimeout(() => { if (!cancelled && !loaded) setState('unavailable') }, 20_000)
    void import('maplibre-gl').then((maplibre) => {
      if (cancelled) return
      moduleRef.current = maplibre
      maplibre.setWorkerUrl('/map-assets/maplibre-6.7.0/maplibre-gl-worker.mjs')
      const map = new maplibre.Map({
        container,
        style: readBrowserPlaceMapStyleUrl(),
        transformRequest: rewriteOpenFreeMapSourceRequest,
        center: centerForBounds(bounds),
        zoom,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: { compact: true },
        trackResize: false,
      })
      mapRef.current = map
      map.touchZoomRotate.disableRotation()
      map.keyboard.disableRotation()
      map.on('style.load', () => {
        localizePlaceMapNames(map)
        configureGlobeAppearance(map)
        configureTransitAppearance(map)
      })
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right')
      map.addControl(new maplibre.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
      }), 'bottom-right')
      const resizeObserver = new ResizeObserver(() => map.resize({ placeLayoutResize: true }))
      resizeObserver.observe(container)
      map.once('remove', () => resizeObserver.disconnect())
      map.on('load', () => {
        if (cancelled) return
        loaded = true
        window.clearTimeout(deadline)
        configurePlaceMapProjection(map)
        const current = featuresRef.current
        installPlaceSource(map, createPlaceFeatureCollection(
          current.markers,
          current.clusters,
          current.selectedMarkerId,
        ))
        accessibleMarkersRef.current = replaceAccessibleMarkers({
          map,
          Marker: maplibre.Marker,
          current: accessibleMarkersRef.current,
          ...current,
          ...(summaryRef.current === null ? {} : { focusFallback: summaryRef.current }),
          styles: { marker: styles.marker, cluster: styles.cluster, selected: styles.selected,
            dot: styles.dot, markerLabel: styles.markerLabel, markerSymbol: styles.markerSymbol,
            collectionMarker: styles.collectionMarker },
          callbacks: {
            onSelect: (markerId) => callbacksRef.current.onSelect(markerId),
            onClusterSelect: (cluster) => callbacksRef.current.onClusterSelect?.(cluster),
          },
        })
        setState('ready')
        void readInitialCameraLocation(initialCameraMode, navigator).then((location) => {
          if (location === undefined || cancelled ||
            initialCameraModeRef.current !== 'granted-current-location') return
          map.jumpTo({ center: [location[0], location[1]] })
        })
      })
      map.on('error', () => {
        if (!loaded && !cancelled) setState('unavailable')
      })
      map.on('moveend', (event) => {
        // A sheet, keyboard, or panel resize is layout, not a new geographic search intent.
        if ('placeLayoutResize' in event && event.placeLayoutResize === true) return
        const synchronization = synchronizingRef.current
        synchronizingRef.current = undefined
        if (synchronization !== undefined) {
          const current = map.getCenter()
          const longitudeDifference = Math.abs((((current.lng - synchronization.center[0]) + 540) % 360) - 180)
          if (longitudeDifference < 1e-7 && Math.abs(current.lat - synchronization.center[1]) < 1e-7 &&
            Math.abs(map.getZoom() - synchronization.zoom) < 1e-7) return
        }
        const viewport = readMapViewport(map)
        reportedViewportRef.current = viewport
        callbacksRef.current.onViewportChange?.(viewport)
      })
      const selectFeature = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0]
        const id = feature?.properties?.featureId
        if (typeof id !== 'string') return
        const current = featuresRef.current
        const marker = current.markers.find((item) => item.id === id)
        if (marker !== undefined) callbacksRef.current.onSelect(marker.id)
        const cluster = current.clusters.find((item) => item.id === id)
        if (cluster !== undefined) callbacksRef.current.onClusterSelect?.(cluster)
      }
      map.on('click', PLACE_LAYER_ID, selectFeature)
      map.on('click', CLUSTER_LAYER_ID, selectFeature)
      for (const layerId of [PLACE_LAYER_ID, CLUSTER_LAYER_ID]) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
      }
    }).catch(() => {
      if (!cancelled) setState('unavailable')
    })
    return () => {
      cancelled = true
      window.clearTimeout(deadline)
      accessibleMarkersRef.current.forEach((marker) => marker.remove())
      accessibleMarkersRef.current = []
      mapRef.current?.remove()
      mapRef.current = undefined
      moduleRef.current = undefined
      reportedViewportRef.current = undefined
      synchronizingRef.current = undefined
    }
  // Recreate only for an explicit retry; ordinary prop synchronization happens below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  useEffect(() => {
    const map = mapRef.current
    const maplibre = moduleRef.current
    if (map === undefined || maplibre === undefined || state !== 'ready') return
    updatePlaceSource(map, createPlaceFeatureCollection(markers, clusters, selectedMarkerId))
    const refreshMarkers = () => { accessibleMarkersRef.current = replaceAccessibleMarkers({
      map,
      Marker: maplibre.Marker,
      current: accessibleMarkersRef.current,
      markers,
      clusters,
      selectedMarkerId,
      mode: markerMode,
      ...(summaryRef.current === null ? {} : { focusFallback: summaryRef.current }),
      styles: { marker: styles.marker, cluster: styles.cluster, selected: styles.selected,
        dot: styles.dot, markerLabel: styles.markerLabel, markerSymbol: styles.markerSymbol,
        collectionMarker: styles.collectionMarker },
      callbacks: {
        onSelect: (markerId) => callbacksRef.current.onSelect(markerId),
        onClusterSelect: (cluster) => callbacksRef.current.onClusterSelect?.(cluster),
      },
    }) }
    refreshMarkers()
    // Layout resize and explicit camera navigation must not leave old screen-space offsets behind.
    map.on('moveend', refreshMarkers)
    return () => { map.off('moveend', refreshMarkers) }
  }, [clusters, markers, selectedMarkerId, state, markerMode, zoom, bounds])

  useEffect(() => {
    const map = mapRef.current
    if (map === undefined || state !== 'ready') return
    const reported = reportedViewportRef.current
    reportedViewportRef.current = undefined
    // The caller stores our observed bounds for querying, not as a camera command.
    // Consume that exact echo once; a later new bounds object is genuine navigation.
    // Globe (and Mercator) bounds midpoints do not describe the actual camera center.
    if (reported?.bounds === bounds && reported.zoom === zoom) return
    const center = centerForBounds(bounds)
    const current = map.getCenter()
    const longitudeDifference = Math.abs((((current.lng - center[0]) + 540) % 360) - 180)
    if (longitudeDifference < 1e-7 && Math.abs(current.lat - center[1]) < 1e-7 &&
      Math.abs(map.getZoom() - zoom) < 1e-7) return
    synchronizingRef.current = { center, zoom }
    map.jumpTo({ center, zoom })
  }, [bounds, state, zoom])

  return (
    <section aria-label={ariaLabel} className={styles.map} data-place-map-globe={zoom < 5} data-place-map-zoom={zoom}>
      <div className={styles.canvas} ref={containerRef} />
      <MapPresentationControls mode={markerMode} onModeChange={setMarkerMode} />
      {activeCluster !== undefined && <CoincidentPlaceChoices cluster={activeCluster} onClose={() => setActiveCluster(undefined)}
        onSelect={onSelect} onOpenPlaceList={onOpenPlaceList} />}
      <p aria-live="polite" className={styles.summary} ref={summaryRef} tabIndex={-1}>
        지도에 장소 {markers.length}개와 장소 묶음 {clusters.length}개가 있습니다.
      </p>
      {onMove !== undefined && (
        <button className={styles.action} onClick={onMove} type="button">{moveLabel}</button>
      )}
      {state !== 'ready' && (
        <div className={styles.status} role="status">
          {state === 'loading' ? '지도를 불러오는 중입니다.' : <>지도를 불러오지 못했습니다. 목록은 계속 사용할 수 있습니다.
            <button type="button" onClick={() => setAttempt((current) => current + 1)}>지도 다시 연결</button>
          </>}
        </div>
      )}
      <p className={styles.summary}>{description}</p>
    </section>
  )
}
