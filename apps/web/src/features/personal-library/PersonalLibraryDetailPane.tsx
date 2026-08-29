'use client'

import { useEffect, useRef } from 'react'

import { PersonalLibraryNotes } from './PersonalLibraryNotes'
import { PersonalLibraryOrganizationEditor } from './PersonalLibraryOrganizationEditor'
import { PersonalLibraryPreferenceEditor } from './PersonalLibraryPreferenceEditor'
import { PersonalLibraryVisits } from './PersonalLibraryVisits'
import styles from './personal-library-browse.module.css'
import { libraryEvidenceLabel } from './personal-library-presentation'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'

export function PersonalLibraryDetailPane({
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow }>) {
  const {
    selectedPlaceId,
    selectedRow,
    selectedDetail,
    detailLoading,
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

  const selectedPlace = selectedDetail ?? selectedRow?.place
  const personalState = selectedDetail?.personalState

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
      ) : detailLoading ? (
        <div className={styles.detailEmpty} role="status">상세 정보를 불러오는 중…</div>
      ) : selectedPlace == null ? (
        <div className={styles.detailEmpty}>상세 정보를 지금 확인할 수 없습니다.</div>
      ) : (
        <>
          <div className={styles.detailHeading}>
            <p>{selectedPlace.primaryTaxonomy?.label ?? '분류 미확인'}</p>
            <h2>{selectedPlace.name}</h2>
            <span>{selectedPlace.areaLabel ?? '지역 정보 없음'}</span>
          </div>
          {personalState !== undefined && <PersonalLibraryPreferenceEditor workflow={workflow} />}
          <nav aria-label="장소 상세 항목" className={styles.detailTabs}>
            <a href="#place-facts">정보</a>
            <a href="#place-organization">내 분류</a>
            <a href="#place-visits">방문</a>
            <a href="#place-notes">메모</a>
          </nav>
          <dl className={styles.placeFacts} id="place-facts">
            <div><dt>정보 상태</dt><dd>{libraryEvidenceLabel(selectedPlace.evidence.status)}</dd></div>
            <div><dt>위치</dt><dd>{selectedPlace.location.latitude.toFixed(5)}, {selectedPlace.location.longitude.toFixed(5)}</dd></div>
          </dl>
          <div id="place-organization"><PersonalLibraryOrganizationEditor workflow={workflow} /></div>
          {personalState !== undefined && <div id="place-visits"><PersonalLibraryVisits visits={workflow.visits} /></div>}
          {personalState !== undefined && <div id="place-notes"><PersonalLibraryNotes notes={workflow.notes} /></div>}
        </>
      )}
    </aside>
  )
}
