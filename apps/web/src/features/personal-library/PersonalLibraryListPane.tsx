'use client'

import type { LibraryPlaceState } from '@place/contracts/library'
import { useEffect, useRef, useState } from 'react'

import styles from './personal-library-browse.module.css'
import { libraryEvidenceLabel } from './personal-library-presentation'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'

const stateTabs: ReadonlyArray<Readonly<{ state: LibraryPlaceState; label: string }>> = [
  { state: 'saved', label: '저장됨' },
  { state: 'wanted', label: '가고 싶음' },
  { state: 'rated', label: '평가함' },
]

export function PersonalLibraryListPane({
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow }>) {
  const {
    surface,
    selectedTagIds,
    tagMatch,
    selectedAreaKeys,
    selectedTaxonomyKeys,
    facets,
    tags,
    tagCursor,
    collections,
    collectionCursor,
    rows,
    nextCursor,
    selectedPlaceId,
    collectionName,
    loading,
    loadingMore,
    metadataLoading,
    mobileSurface,
    chooseState,
    chooseCollection,
    toggleTag,
    toggleArea,
    toggleTaxonomy,
    setTagMatch,
    selectPlace,
    loadMore,
    loadMoreTags,
    loadMoreCollections,
  } = workflow
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const previousMobileSurface = useRef(mobileSurface)
  const selectedRowButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (previousMobileSurface.current === mobileSurface) return
    previousMobileSurface.current = mobileSurface
    if (mobileSurface === 'list' && window.matchMedia('(max-width: 720px)').matches) {
      selectedRowButton.current?.focus()
    }
  }, [mobileSurface])

  const activeState = surface.kind === 'state' ? surface.state : undefined
  const filterCount = selectedAreaKeys.length + selectedTaxonomyKeys.length + selectedTagIds.length

  return (
    <section aria-label="장소 목록" className={styles.listPane}>
      <div className={styles.listControls}>
        <div aria-label="장소 상태" className={styles.tabs} role="tablist">
          {stateTabs.map((tab) => (
            <button
              aria-selected={activeState === tab.state}
              key={tab.state}
              onClick={() => chooseState(tab.state)}
              role="tab"
              type="button"
            >{tab.label}</button>
          ))}
        </div>

        <div className={styles.collectionStrip}>
          <span>컬렉션</span>
          <div aria-label="내 컬렉션">
            {collections.map((collection) => (
              <button
                aria-current={surface.kind === 'collection' && surface.collectionId === collection.collectionId ? 'page' : undefined}
                key={collection.collectionId}
                onClick={() => chooseCollection(collection.collectionId)}
                type="button"
              >
                <span>{collection.name}</span><small>{collection.placeCount}</small>
              </button>
            ))}
            {!metadataLoading && collections.length === 0 && <span>아직 컬렉션이 없습니다.</span>}
            {collectionCursor !== undefined && (
              <button onClick={() => void loadMoreCollections()} type="button">더 보기</button>
            )}
          </div>
        </div>

        <button
          aria-controls="personal-library-filters"
          aria-expanded={mobileFiltersOpen}
          className={styles.mobileFilterButton}
          onClick={() => setMobileFiltersOpen((current) => !current)}
          type="button"
        >
          {mobileFiltersOpen ? '필터 닫기' : '필터 열기'}
          {filterCount > 0 && <span>{filterCount}</span>}
        </button>

        <div
          className={mobileFiltersOpen ? `${styles.filterGroups} ${styles.filtersOpen}` : styles.filterGroups}
          id="personal-library-filters"
        >
          <div className={styles.facetControls}>
            <span className={styles.filterLabel}>지역</span>
            <div aria-label="저장 장소 지역 필터" className={styles.facetOptions}>
              {facets?.areas.map((facet) => (
                <button
                  aria-pressed={selectedAreaKeys.includes(facet.key)}
                  disabled={!selectedAreaKeys.includes(facet.key) && selectedAreaKeys.length >= 10}
                  key={facet.key}
                  onClick={() => toggleArea(facet.key)}
                  type="button"
                >{facet.label}<span>{facet.count}</span></button>
              ))}
              {!metadataLoading && facets?.areas.length === 0 && <span className={styles.emptyOption}>표시할 지역이 없습니다.</span>}
            </div>
          </div>

          <div className={styles.facetControls}>
            <span className={styles.filterLabel}>분류</span>
            <div aria-label="저장 장소 분류 필터" className={styles.facetOptions}>
              {facets?.taxonomies.map((facet) => (
                <button
                  aria-pressed={selectedTaxonomyKeys.includes(facet.key)}
                  disabled={!selectedTaxonomyKeys.includes(facet.key) && selectedTaxonomyKeys.length >= 10}
                  key={facet.key}
                  onClick={() => toggleTaxonomy(facet.key)}
                  type="button"
                >{facet.label}<span>{facet.count}</span></button>
              ))}
              {!metadataLoading && facets?.taxonomies.length === 0 && <span className={styles.emptyOption}>표시할 분류가 없습니다.</span>}
            </div>
          </div>

          <div className={styles.tagControls}>
            <span className={styles.filterLabel}>태그</span>
            <div aria-label="태그 필터" className={styles.facetOptions}>
              {tags.map((tag) => (
                <button
                  aria-pressed={selectedTagIds.includes(tag.tagId)}
                  key={tag.tagId}
                  onClick={() => toggleTag(tag.tagId)}
                  type="button"
                >{tag.name}<span>{tag.placeCount}</span></button>
              ))}
              {!metadataLoading && tags.length === 0 && <span className={styles.emptyOption}>아직 태그가 없습니다.</span>}
              {tagCursor !== undefined && (
                <button className={styles.inlineMore} onClick={() => void loadMoreTags()} type="button">더 보기</button>
              )}
            </div>
            {selectedTagIds.length > 1 && (
              <div aria-label="태그 일치 방식" className={styles.matchMode}>
                <button aria-pressed={tagMatch === 'all'} onClick={() => setTagMatch('all')} type="button">모두</button>
                <button aria-pressed={tagMatch === 'any'} onClick={() => setTagMatch('any')} type="button">하나 이상</button>
              </div>
            )}
          </div>

          {facets !== undefined && (
            <small className={styles.facetCoverage}>
              저장 장소 {facets.coverage.savedPlaceCount}개 기준
              {facets.coverage.projectedPlaceCount < facets.coverage.sampledPlaceCount
                ? ` · 기본 정보 ${facets.coverage.projectedPlaceCount}개 반영`
                : ''}
              {!facets.coverage.complete ? ' · 상위 선택지만 표시' : ''}
            </small>
          )}
        </div>
      </div>

      <div className={styles.listHeading}>
        <strong>{collectionName ?? stateTabs.find((tab) => tab.state === activeState)?.label ?? '내 장소'}</strong>
        <span>{loading ? '불러오는 중…' : `${rows.length}개`}</span>
      </div>
      {!loading && workflow.error === undefined && rows.length === 0 && (
        <div className={styles.empty}>
          <strong>이 조건에 맞는 장소가 없습니다.</strong>
          <span>다른 상태나 필터, 컬렉션을 선택해 보세요.</span>
        </div>
      )}
      <ol className={styles.placeList}>
        {rows.map((row, index) => (
          <li key={row.placeId}>
            <button
              aria-pressed={selectedPlaceId === row.placeId}
              onClick={() => selectPlace(row.placeId)}
              ref={selectedPlaceId === row.placeId ? selectedRowButton : undefined}
              type="button"
            >
              <span className={styles.resultNumber}>{index + 1}</span>
              <span className={styles.placeText}>
                <strong>{row.place?.name ?? '장소 정보 동기화 중'}</strong>
                <span>{row.place?.primaryTaxonomy?.label ?? '분류 미확인'} · {row.place?.areaLabel ?? '지역 정보 없음'}</span>
                <small>
                  {row.personalRating === undefined || row.personalRating === null ? '' : `내 평점 ${row.personalRating.toFixed(1)} · `}
                  {row.place === null ? '기본 정보 대기' : libraryEvidenceLabel(row.place.evidence.status)}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {nextCursor !== undefined && (
        <button className={styles.more} disabled={loadingMore} onClick={loadMore} type="button">
          {loadingMore ? '불러오는 중…' : '장소 더 보기'}
        </button>
      )}
    </section>
  )
}
