import type { PublishedCollection } from '@place/contracts/http'

import styles from './publication.module.css'

export function PublishedCollectionPlaces({
  places,
  selectedPlaceId,
  onSelect,
}: Readonly<{
  places: PublishedCollection['places']
  selectedPlaceId?: string
  onSelect: (placeId: string) => void
}>) {
  return (
    <ol aria-label="공유된 장소" className={styles.list}>
      {places.map((item) => {
        const metadata = item.place === null
          ? []
          : [item.place.primaryTaxonomy?.label, item.place.areaLabel]
            .filter((value): value is string => value !== null && value !== undefined)
        return (
          <li
            className={item.placeId === selectedPlaceId
              ? `${styles.item} ${styles.selectedItem}`
              : styles.item}
            key={item.placeId}
          >
            <span className={styles.position}>{item.position + 1}</span>
            {item.place === null ? (
              <span className={styles.pending}>장소 정보를 준비 중입니다.</span>
            ) : (
              <button
                className={styles.placeSummary}
                onClick={() => onSelect(item.placeId)}
                type="button"
              >
                <strong>{item.place.name}</strong>
                {metadata.length > 0 && <span>{metadata.join(' · ')}</span>}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}
