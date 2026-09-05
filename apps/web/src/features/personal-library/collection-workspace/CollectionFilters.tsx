import { useState } from 'react'

import type { CollectionLibraryWorkflow } from './collection-library-workflow'
import styles from './collection-workspace.module.css'

type Group = 'area' | 'taxonomy' | 'tag' | 'rating'
const labels = { area: '지역', taxonomy: '장소·음식 분류', tag: '개인 태그', rating: '내 평점' } as const
const pageSize = 12

export function CollectionFilters({ workflow, onClose }: Readonly<{ workflow: CollectionLibraryWorkflow; onClose: () => void }>) {
  const [group, setGroup] = useState<Group | undefined>()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const selected = group === 'area' ? workflow.areaKeys : group === 'taxonomy' ? workflow.taxonomyKeys : workflow.tagIds
  const options = group === 'area' ? workflow.availableFilters?.areas ?? []
    : group === 'taxonomy' ? workflow.availableFilters?.taxonomies ?? []
      : workflow.tags.map((tag) => ({ key: tag.tagId, label: tag.name, count: tag.placeCount }))
  const matching = options.filter((option) => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const toggle = group === 'area' ? workflow.toggleArea : group === 'taxonomy' ? workflow.toggleTaxonomy : workflow.toggleTag
  const maximum = group === 'tag' ? 20 : 10
  const coverage = workflow.availableFilters?.coverage
  return <>
    <header className={styles.panelHeader}>
      <button autoFocus className={styles.backButton} type="button" onClick={group ? () => { setGroup(undefined); setQuery(''); setLimit(pageSize) } : onClose}>
        ← {group ? '필터 종류' : '장소 목록으로'}
      </button>
      <span className={styles.eyebrow}>{workflow.selectedCollection?.name ?? '내 모든 목록'} 안에서</span>
      <h2>{group ? labels[group] : '장소 필터'}</h2>
      <p>카테고리와 장소 분류, 개인 기록은 서로 다른 조건입니다.</p>
      {group && group !== 'rating' && <label className={styles.filterSearch}>
        <span>{group === 'tag' ? '불러온 태그에서 검색' : '제공된 분류 후보에서 검색'}</span>
        <input type="search" value={query} placeholder={group === 'taxonomy' ? '예: 쇼유라멘' : '이름으로 찾기'}
          onChange={(event) => { setQuery(event.target.value); setLimit(pageSize) }} />
      </label>}
    </header>
    <div className={styles.scrollArea}>
      {!group ? <div className={styles.filterGroups}>
        {(Object.keys(labels) as Group[]).map((key) => <button key={key} type="button" onClick={() => setGroup(key)}>
          <strong>{labels[key]}</strong><span>{key === 'area' ? workflow.areaKeys.length : key === 'taxonomy' ? workflow.taxonomyKeys.length : key === 'tag' ? workflow.tagIds.length : workflow.ratingFilter === 'any' ? 0 : 1}개 선택 ›</span>
        </button>)}
      </div> : group === 'rating' ? <fieldset className={styles.filterOptions}><legend>내가 남긴 평점</legend>
        {(['any', 'rated', 'unrated'] as const).map((value) => <label key={value}><input type="radio" name="library-rating"
          checked={workflow.ratingFilter === value} onChange={() => workflow.setRatingFilter(value)} />
          <span>{value === 'any' ? '전체' : value === 'rated' ? '내 평점 있음' : '내 평점 없음'}</span></label>)}
      </fieldset> : <>
        <p className={styles.notice}>{group === 'tag' ? '여러 태그를 선택하면 모두 포함한 장소를 찾습니다.' : '같은 종류 안에서는 하나 이상, 서로 다른 종류 사이에서는 모두 일치하는 장소를 찾습니다.'}</p>
        {group === 'tag' && workflow.tagError && <p className={styles.inlineError} role="alert">태그를 불러오지 못했습니다. 목록 검색은 계속 사용할 수 있습니다.</p>}
        <fieldset className={styles.filterOptions}><legend>{labels[group]} 선택 · 최대 {maximum}개</legend>
          {matching.slice(0, limit).map((option) => <label key={option.key}>
            <input type="checkbox" checked={selected.includes(option.key)} disabled={!selected.includes(option.key) && selected.length >= maximum}
              onChange={() => toggle(option.key)} />
            <span>{option.label}</span><small>{option.count}</small>
          </label>)}
        </fieldset>
        {matching.length === 0 && <p className={styles.notice}>제공된 후보에서 찾지 못했습니다. 장소 검색어로도 찾아보세요.</p>}
        {matching.length > limit && <button className={styles.loadMore} type="button" onClick={() => setLimit(limit + pageSize)}>후보 더 보기</button>}
        {group === 'tag' && workflow.tagNextCursor && <button className={styles.loadMore} type="button" disabled={workflow.loadingMoreTags}
          onClick={() => void workflow.loadMoreTags()}>{workflow.loadingMoreTags ? '불러오는 중…' : '다음 태그 불러오기'}</button>}
      </>}
      <div className={styles.coverageNotice}>
        <strong>분류 정보는 일부일 수 있어요</strong>
        <p>지역·음식 분류 후보는 최대 50개이며, 등록되지 않은 세부 음식은 나타나지 않을 수 있습니다. 분류가 없다는 뜻이 판매하지 않는다는 뜻은 아닙니다.</p>
        {coverage && <small>선택 범위 {coverage.favoritePlaceCount}개 중 {coverage.sampledPlaceCount}개 확인 · 장소 정보 {coverage.projectedPlaceCount}개
          {!coverage.complete && ' · 일부 정보만 제공됨'}</small>}
      </div>
    </div>
    <footer className={styles.filterFooter}><button type="button" onClick={workflow.clearFilters}>필터 초기화</button><button type="button" onClick={onClose}>장소 보기</button></footer>
  </>
}
