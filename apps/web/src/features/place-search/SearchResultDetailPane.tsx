'use client'

import { useEffect, useRef } from 'react'

import styles from './search-detail.module.css'
import type {
  SearchCanonicalPlaceDetailRenderer,
  SearchDetailInterface,
} from './search-workspace-interface'

export function SearchResultDetailPane({
  detail,
  renderCanonicalPlaceDetail,
}: Readonly<{
  detail: SearchDetailInterface
  renderCanonicalPlaceDetail?: SearchCanonicalPlaceDetailRenderer
}>) {
  const {
    selected,
    mobileSurface,
    dismissDetail,
    showList,
  } = detail
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
    <aside aria-label="선택한 검색 결과 상세" className={styles.detail}>
      <div className={styles.detailActions}>
        <button
          className={styles.mobileBack}
          onClick={showList}
          ref={mobileBackButton}
          type="button"
        >← 목록으로</button>
        <button
          aria-label="검색 결과 상세 닫기"
          className={styles.desktopClose}
          onClick={dismissDetail}
          type="button"
        >×</button>
      </div>

      {selected === undefined ? (
        <div className={styles.detailEmpty}>목록이나 지도에서 장소를 선택하세요.</div>
      ) : selected.identity.kind === 'canonical' && renderCanonicalPlaceDetail !== undefined ? (
        renderCanonicalPlaceDetail({
          placeId: selected.identity.placeId,
          summary: {
            name: selected.name,
            areaLabel: selected.areaLabel,
            location: selected.location,
            primaryTaxonomy: selected.primaryTaxonomy,
            evidenceStatus: selected.evidenceStatus,
            sourceLabel: '로컬 색인',
          },
        })
      ) : (
        <>
          <div className={styles.detailHeading}>
            <p>{selected.primaryTaxonomy?.label ?? selected.source.categoryLabel ?? '분류 미확인'}</p>
            <h2>{selected.name}</h2>
            <span>{selected.areaLabel ?? '지역 정보 없음'}</span>
          </div>

          <dl className={styles.placeFacts}>
            <div>
              <dt>정보 출처</dt>
              <dd>{selected.identity.kind === 'canonical' ? '로컬 색인' : selected.source.label}</dd>
            </div>
            <div>
              <dt>정보 상태</dt>
              <dd>{selected.evidenceStatus === 'verified' ? '검증됨' : '확인 필요'}</dd>
            </div>
            <div>
              <dt>위치</dt>
              <dd>{selected.location.latitude.toFixed(5)}, {selected.location.longitude.toFixed(5)}</dd>
            </div>
          </dl>

        </>
      )}
    </aside>
  )
}
