'use client'

import { useEffect, useRef } from 'react'

import { PersonalPlaceDetail } from './PersonalPlaceDetail'
import styles from './personal-library-browse.module.css'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'

export function PersonalLibraryDetailPane({
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow }>) {
  const {
    selectedPlaceId,
    selectedRow,
    mobileSurface,
    dismissDetail,
    showMobileSurface,
  } = workflow
  const previousMobileSurface = useRef(mobileSurface)
  const mobileBackButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (previousMobileSurface.current === mobileSurface) return
    previousMobileSurface.current = mobileSurface
    if (mobileSurface === 'detail' && window.matchMedia('(max-width: 720px)').matches) {
      mobileBackButton.current?.focus()
    }
  }, [mobileSurface])

  return (
    <aside aria-label="선택한 장소 상세" className={styles.detailPane}>
      <div className={styles.detailActions}>
        <button
          className={styles.mobileBack}
          onClick={() => showMobileSurface('list')}
          ref={mobileBackButton}
          type="button"
        >← 목록으로</button>
        <button
          aria-label="상세 닫기"
          className={styles.desktopClose}
          onClick={dismissDetail}
          type="button"
        >×</button>
      </div>
      {selectedPlaceId === undefined ? (
        <div className={styles.detailEmpty}>목록이나 지도에서 장소를 선택하세요.</div>
      ) : (
        <PersonalPlaceDetail
          onChanged={workflow.refreshAfterPlaceChange}
          placeId={selectedPlaceId}
          summary={selectedRow?.place == null ? undefined : {
            name: selectedRow.place.name,
            areaLabel: selectedRow.place.areaLabel,
            location: selectedRow.place.location,
            primaryTaxonomy: selectedRow.place.primaryTaxonomy,
            evidenceStatus: selectedRow.place.evidence.status,
          }}
        />
      )}
    </aside>
  )
}
