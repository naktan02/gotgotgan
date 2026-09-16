import styles from './deterministic-place-map.module.css'

import type { PlaceMapRendererProperties } from '../place-map-interface'

function percent(value: number, minimum: number, maximum: number): string {
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
  return `${Math.round(normalized * 100 * 1_000_000) / 1_000_000}%`
}

function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180
}

export function DeterministicPlaceMap({
  ariaLabel = '장소 지도', bounds, clusters = [], markers, selectedMarkerId, zoom = 12,
  description = '결정적 좌표 테스트 지도', moveLabel = '동쪽으로 이동', title = '테스트 공간 보기',
  onClusterSelect, onSelect, onMove, onViewportChange,
}: PlaceMapRendererProperties) {
  const unwrappedEast = bounds.west > bounds.east ? bounds.east + 360 : bounds.east
  const longitudeSpan = unwrappedEast - bounds.west
  const latitudeSpan = bounds.north - bounds.south
  const markerLongitude = (value: number) => bounds.west > bounds.east && value < bounds.west
    ? value + 360
    : value
  const changeZoom = (factor: number, nextZoom: number) => onViewportChange?.({
    zoom: nextZoom,
    bounds: {
      west: normalizeLongitude((bounds.west + unwrappedEast) / 2 - longitudeSpan * factor / 2),
      east: normalizeLongitude((bounds.west + unwrappedEast) / 2 + longitudeSpan * factor / 2),
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
            <button aria-label="지도 확대" disabled={zoom >= 22} onClick={() => changeZoom(.5, Math.min(22, zoom + 1))} type="button">+</button>
            <button aria-label="지도 축소" disabled={zoom <= 0} onClick={() => changeZoom(2, Math.max(0, zoom - 1))} type="button">−</button>
          </>)}
          {onMove !== undefined && <button onClick={onMove} type="button">{moveLabel}</button>}
        </div>
      </div>
      <p className={styles.mapNote}>{description}</p>
      {clusters.map((cluster) => <button
        aria-label={`${cluster.count}개 장소 묶음 확대`}
        className={styles.cluster}
        key={cluster.id}
        onClick={() => onClusterSelect?.(cluster)}
        style={{
          left: percent(markerLongitude(cluster.location.longitude), bounds.west, unwrappedEast),
          top: percent(bounds.north - cluster.location.latitude, 0, bounds.north - bounds.south),
        }}
        type="button"
      >{cluster.count}</button>)}
      {markers.map((marker, index) => <button
        aria-label={`${marker.label} 지도에서 선택`}
        aria-pressed={marker.id === selectedMarkerId}
        className={marker.id === selectedMarkerId ? `${styles.marker} ${styles.selected}` : styles.marker}
        key={marker.id}
        onClick={() => onSelect(marker.id)}
        style={{
          left: percent(markerLongitude(marker.location.longitude), bounds.west, unwrappedEast),
          top: percent(bounds.north - marker.location.latitude, 0, bounds.north - bounds.south),
        }}
        type="button"
      >{index + 1}</button>)}
    </section>
  )
}
