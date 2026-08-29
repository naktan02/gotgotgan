'use client'

import { useEffect, useRef } from 'react'

import styles from './search-workspace.module.css'
import type { SearchWorkspaceWorkflow } from './search-workspace-workflow'

export function SearchResultDetailPane({
  workflow,
}: Readonly<{ workflow: SearchWorkspaceWorkflow }>) {
  const {
    selected,
    providerDetail,
    detailState,
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
    <aside aria-label="선택한 검색 결과 상세" className={styles.detailPane}>
      <div className={styles.detailActions}>
        <button
          className={styles.mobileBack}
          onClick={() => showMobileSurface('list')}
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

          {selected.identity.kind === 'provider' && (
            <section aria-live="polite" className={styles.providerSection}>
              <div className={styles.providerHeading}>
                <div>
                  <p>공급자 정보</p>
                  <strong>{selected.source.label}에서 방금 확인</strong>
                </div>
                {selected.source.externalUri !== undefined && (
                  <a href={selected.source.externalUri} rel="noreferrer" target="_blank">
                    {selected.source.label}에서 열기
                  </a>
                )}
              </div>

              {detailState === 'idle' && (
                <p className={styles.detailStatus}>이 공급자는 검색 결과의 기본 정보만 제공합니다.</p>
              )}
              {detailState === 'loading' && <p className={styles.detailStatus}>최신 상세를 확인하는 중…</p>}
              {detailState === 'unavailable' && <p className={styles.detailStatus}>상세 정보는 지금 불러올 수 없습니다.</p>}
              {providerDetail !== undefined && (
                <div className={styles.providerDetail}>
                  {providerDetail.photos[0]?.mediaUri !== undefined && (
                    <img alt={`${providerDetail.name} 공급자 사진`} src={providerDetail.photos[0].mediaUri} />
                  )}
                  <div>
                    {providerDetail.rating !== undefined && (
                      <strong>평점 {providerDetail.rating.toFixed(1)}{providerDetail.userRatingCount === undefined ? '' : ` · ${providerDetail.userRatingCount}개 평가`}</strong>
                    )}
                    {providerDetail.openingHours?.openNow !== undefined && (
                      <span>{providerDetail.openingHours.openNow ? '현재 영업 중' : '현재 영업 종료'}</span>
                    )}
                    {providerDetail.phone !== undefined && <span>{providerDetail.phone}</span>}
                  </div>
                  <div className={styles.attributions} aria-label="정보 및 사진 출처">
                    {[...providerDetail.attributions, ...providerDetail.photos.flatMap((photo) => photo.authorAttributions)].map((attribution, index) => (
                      attribution.uri === undefined
                        ? <span key={`${attribution.label}:${index}`}>{attribution.label}</span>
                        : <a href={attribution.uri} key={`${attribution.label}:${index}`} rel="noreferrer" target="_blank">{attribution.label}</a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  )
}
