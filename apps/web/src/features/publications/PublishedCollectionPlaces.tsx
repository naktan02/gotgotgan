import type { PublishedCollection } from '@place/contracts/http'

import styles from './publication.module.css'

export function PublishedCollectionPlaces({
  places,
}: Readonly<{ places: PublishedCollection['places'] }>) {
  return (
    <ol aria-label="공유된 장소" className={styles.list}>
      {places.map((item) => {
        const metadata = item.place === null
          ? []
          : [item.place.primaryTaxonomy?.label, item.place.areaLabel]
            .filter((value): value is string => value !== null && value !== undefined)
        return (
          <li className={styles.item} key={item.placeId}>
            <span className={styles.position}>{item.position + 1}</span>
            {item.place === null ? (
              <span className={styles.pending}>장소 정보를 준비 중입니다.</span>
            ) : (
              <div className={styles.placeSummary}>
                <strong>{item.place.name}</strong>
                {metadata.length > 0 && <span>{metadata.join(' · ')}</span>}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
