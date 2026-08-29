import styles from './deterministic-place-map.module.css'

import type { PlaceMapBounds, PlaceMapMarker } from './place-map-interface'

function percent(value: number, minimum: number, maximum: number): string {
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
  return `${normalized * 100}%`
}

export function DeterministicPlaceMap({
  ariaLabel = '장소 지도',
  bounds,
  description = '실제 지도 Provider 연결 전의 결정적 좌표 화면',
  markers,
  moveLabel = '동쪽으로 이동',
  selectedMarkerId,
  title = '로컬 공간 보기',
  onSelect,
  onMove,
}: Readonly<{
  ariaLabel?: string
  bounds: PlaceMapBounds
  description?: string
  markers: readonly PlaceMapMarker[]
  moveLabel?: string
  selectedMarkerId?: string
  title?: string
  onSelect: (markerId: string) => void
  onMove?: () => void
}>) {
  return (
    <section aria-label={ariaLabel} className={styles.map}>
      <div aria-hidden="true" className={styles.grid} />
      <div className={styles.mapHeader}>
        <span>{title}</span>
        {onMove !== undefined && <button onClick={onMove} type="button">{moveLabel}</button>}
      </div>
      <p className={styles.mapNote}>{description}</p>
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
