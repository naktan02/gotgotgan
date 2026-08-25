import type { PlaceSearchResult, SearchBounds } from '@place/contracts/search'

import styles from './deterministic-place-map.module.css'

function percent(value: number, minimum: number, maximum: number): string {
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
  return `${normalized * 100}%`
}

export function DeterministicPlaceMap({
  bounds,
  results,
  selectedPlaceId,
  onSelect,
  onPan,
}: Readonly<{
  bounds: SearchBounds
  results: readonly PlaceSearchResult[]
  selectedPlaceId?: string
  onSelect: (placeId: string) => void
  onPan: () => void
}>) {
  return (
    <section aria-label="검색 결과 지도" className={styles.map}>
      <div aria-hidden="true" className={styles.grid} />
      <div className={styles.mapHeader}>
        <span>로컬 공간 보기</span>
        <button onClick={onPan} type="button">동쪽으로 이동</button>
      </div>
      <p className={styles.mapNote}>실제 지도 Provider 연결 전의 결정적 좌표 화면</p>
      {results.map((result, index) => (
        <button
          aria-label={`${result.name} 지도에서 선택`}
          aria-pressed={result.placeId === selectedPlaceId}
          className={result.placeId === selectedPlaceId ? `${styles.marker} ${styles.selected}` : styles.marker}
          key={result.placeId}
          onClick={() => onSelect(result.placeId)}
          style={{
            left: percent(result.location.longitude, bounds.west, bounds.east),
            top: percent(bounds.north - result.location.latitude, 0, bounds.north - bounds.south),
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
