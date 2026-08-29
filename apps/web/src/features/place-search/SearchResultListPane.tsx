'use client'

import { useEffect, useRef } from 'react'

import styles from './search-results.module.css'
import type { SearchResultsInterface } from './search-workspace-interface'

export function SearchResultListPane({
  results,
}: Readonly<{ results: SearchResultsInterface }>) {
  const {
    items,
    nextCursor,
    selectedResultId,
    loading,
    loadingMore,
    error,
    boundsApplied,
    mobileSurface,
    loadMore,
    selectResult,
  } = results
  const previousMobileSurface = useRef(mobileSurface)
  const selectedRowButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (previousMobileSurface.current === mobileSurface) return
    previousMobileSurface.current = mobileSurface
    if (mobileSurface === 'list' && window.matchMedia('(max-width: 720px)').matches) {
      selectedRowButton.current?.focus()
    }
  }, [mobileSurface])

  return (
    <section aria-label="검색 결과 목록" className={styles.results}>
      <div className={styles.resultMeta}>
        <span>{loading ? '검색 중…' : `${items.length}개 결과`}</span>
        {boundsApplied && <span>지도 영역 적용됨</span>}
      </div>
      {!loading && error === undefined && items.length === 0 && (
        <div className={styles.empty}>
          <strong>조건에 맞는 장소가 없습니다.</strong>
          <span>검색어나 분류, 지도 영역을 바꿔보세요.</span>
        </div>
      )}
      <ol aria-label="장소 검색 결과" className={styles.resultList}>
        {items.map((item, index) => (
          <li key={item.resultId}>
            <button
              aria-pressed={item.resultId === selectedResultId}
              className={item.resultId === selectedResultId ? `${styles.resultRow} ${styles.selectedRow}` : styles.resultRow}
              onClick={() => selectResult(item.resultId)}
              ref={item.resultId === selectedResultId ? selectedRowButton : undefined}
              type="button"
            >
              <span className={styles.resultNumber}>{index + 1}</span>
              <span className={styles.resultText}>
                <strong>{item.name}</strong>
                <span>{item.primaryTaxonomy?.label ?? item.source.categoryLabel ?? '분류 미확인'} · {item.areaLabel ?? '지역 정보 없음'}</span>
                <span className={styles.evidence}>{item.evidenceStatus === 'verified' ? '검증됨' : '확인 필요'} · {item.identity.kind === 'canonical' ? '로컬 색인' : item.source.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {nextCursor !== undefined && (
        <button
          className={styles.moreButton}
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? '불러오는 중…' : '결과 더 보기'}
        </button>
      )}
    </section>
  )
}
