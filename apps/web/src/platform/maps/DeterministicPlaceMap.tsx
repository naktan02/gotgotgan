import styles from './deterministic-place-map.module.css'

import type {
  PlaceMapBounds,
  PlaceMapCluster,
  PlaceMapMarker,
  PlaceMapViewport,
} from './place-map-interface'

function percent(value: number, minimum: number, maximum: number): string {
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
  return `${normalized * 100}%`
}

export function DeterministicPlaceMap({
  ariaLabel = '장소 지도',
  bounds,
  clusters = [],
  description = '실제 지도 Provider 연결 전의 결정적 좌표 화면',
  markers,
  moveLabel = '동쪽으로 이동',
  selectedMarkerId,
  title = '로컬 공간 보기',
  zoom = 12,
  onClusterSelect,
  onSelect,
  onMove,
  onViewportChange,
}: Readonly<{
  ariaLabel?: string
  bounds: PlaceMapBounds
  clusters?: readonly PlaceMapCluster[]
  description?: string
  markers: readonly PlaceMapMarker[]
  moveLabel?: string
  selectedMarkerId?: string
  title?: string
  zoom?: number
  onClusterSelect?: (cluster: PlaceMapCluster) => void
  onSelect: (markerId: string) => void
  onMove?: () => void
  onViewportChange?: (viewport: PlaceMapViewport) => void
}>) {
  const longitudeSpan = bounds.east - bounds.west
  const latitudeSpan = bounds.north - bounds.south
  const changeZoom = (factor: number, nextZoom: number) => onViewportChange?.({
    zoom: nextZoom,
    bounds: {
      west: (bounds.west + bounds.east) / 2 - longitudeSpan * factor / 2,
      east: (bounds.west + bounds.east) / 2 + longitudeSpan * factor / 2,
      south: (bounds.south + bounds.north) / 2 - latitudeSpan * factor / 2,
      north: (bounds.south + bounds.north) / 2 + latitudeSpan * factor / 2,
    },
  })
  return (
    <section aria-label={ariaLabel} className={styles.map}>
      <div aria-hidden="true" className={styles.grid} />
      <div className={styles.mapHeader}>
        <span>{title}</span>
        <div className={styles.mapControls}>
          {onViewportChange !== undefined && (<>
            <button
              aria-label="지도 확대"
              disabled={zoom >= 22}
              onClick={() => changeZoom(0.5, Math.min(22, zoom + 1))}
              type="button"
            >+</button>
            <button
              aria-label="지도 축소"
              disabled={zoom <= 0}
              onClick={() => changeZoom(2, Math.max(0, zoom - 1))}
              type="button"
            >−</button>
            <button
              onClick={() => onViewportChange({
                zoom,
                bounds: {
                  west: bounds.west + longitudeSpan / 2,
                  east: bounds.east + longitudeSpan / 2,
                  south: bounds.south,
                  north: bounds.north,
                },
              })}
              type="button"
            >동쪽 이동</button>
          </>)}
          {onMove !== undefined && <button onClick={onMove} type="button">{moveLabel}</button>}
        </div>
      </div>
      <p className={styles.mapNote}>{description}</p>
      {clusters.map((cluster) => (
        <button
          aria-label={`${cluster.count}개 장소 묶음 확대`}
          className={styles.cluster}
          key={cluster.id}
          onClick={() => onClusterSelect?.(cluster)}
          style={{
            left: percent(cluster.location.longitude, bounds.west, bounds.east),
            top: percent(bounds.north - cluster.location.latitude, 0, bounds.north - bounds.south),
          }}
          type="button"
        >{cluster.count}</button>
      ))}
      {markers.map((marker, index) => (
        <button
          aria-label={`${marker.label} 지도에서 선택`}
          aria-pressed={marker.id === selectedMarkerId}
          className={marker.id === selectedMarkerId ? `${styles.marker} ${styles.selected}` : styles.marker}
          key={marker.id}
          onClick={() => onSelect(marker.id)}
          style={{
            left: percent(marker.location.longitude, bounds.west, bounds.east),
            top: percent(bounds.north - marker.location.latitude, 0, bounds.north - bounds.south),
          }}
          type="button"
        >
          {index + 1}
        </button>
      ))}
      <span aria-hidden="true" className={styles.north}>N</span>
    </section>
  )
}
