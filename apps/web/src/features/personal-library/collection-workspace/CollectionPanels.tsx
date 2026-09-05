import { useEffect, useState } from 'react'

import { CollectionManagementPanel } from '../collection-management/CollectionManagementPanel'
import { TagManagementPanel } from '../tag-management/TagManagementPanel'
import type { CollectionLibraryWorkflow } from './collection-library-workflow'
import styles from './collection-workspace.module.css'

type Properties = Readonly<{ workflow: CollectionLibraryWorkflow; onSelect: (id: string, button: HTMLButtonElement) => void }>
const visibilityLabel = { private: '비공개', unlisted: '링크 공개', public: '전체 공개' } as const

function CollectionCreation({ workflow }: Readonly<{ workflow: CollectionLibraryWorkflow }>) {
  return <form className={styles.creation} onSubmit={(event) => { event.preventDefault(); void workflow.createCollection() }}>
    <label htmlFor="new-collection-name">카테고리 이름</label>
    <div><input id="new-collection-name" maxLength={120} onChange={(event) => workflow.setNewCollectionName(event.target.value)}
      placeholder="예: 서울 라멘" value={workflow.newCollectionName} />
      <button disabled={workflow.collectionMutation !== 'idle' || !workflow.newCollectionName.trim()} type="submit">
        {workflow.collectionMutation === 'creating' ? '만드는 중…' : '카테고리 만들기'}
      </button></div>
  </form>
}

export function CollectionDirectory({ workflow, onSelect, onAllPlaces }: Properties & Readonly<{
  onAllPlaces: (button: HTMLButtonElement) => void
}>) {
  const [query, setQuery] = useState(workflow.collectionQuery)
  const [creating, setCreating] = useState(false)
  useEffect(() => { setQuery(workflow.collectionQuery) }, [workflow.collectionQuery])
  return <>
    <header className={styles.panelHeader}>
      <span className={styles.eyebrow}>내가 모아 둔 장소</span><h1>내 목록</h1>
      <p>즐겨찾기 카테고리를 선택해 장소를 살펴보세요.</p>
      <form className={styles.search} role="search" aria-label="내 목록 검색" onSubmit={(event) => {
        event.preventDefault(); workflow.setCollectionQuery(query.trim())
      }}>
        <label className={styles.srOnly} htmlFor="library-collection-query">카테고리 이름 검색</label>
        <input id="library-collection-query" type="search" maxLength={160} placeholder="카테고리 이름 검색"
          value={query ?? ''} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">검색</button>
      </form>
      <div className={styles.actions}>
        <button type="button" aria-expanded={creating} onClick={() => setCreating(!creating)}>＋ 목록 만들기</button>
        <a href="/settings?tab=import">가져오기</a>
      </div>
    </header>
    <div className={styles.scrollArea}>
      {creating && <CollectionCreation workflow={workflow} />}
      {workflow.collectionMessage && <p className={styles.inlineError} role="alert">{workflow.collectionMessage}</p>}
      {workflow.loadingCollections && <p className={styles.notice} role="status">내 목록을 불러오는 중…</p>}
      {!workflow.loadingCollections && workflow.pageStatus === 'ready' && workflow.collections.length === 0 && <div className={styles.emptyState}>
        <strong>{workflow.collectionQuery ? '이름이 일치하는 목록이 없습니다.' : '첫 카테고리를 만들어 보세요.'}</strong>
        <span>장소는 사용자가 만든 카테고리에 포함될 때 즐겨찾기가 됩니다.</span>
        {!creating && !workflow.collectionQuery && <CollectionCreation workflow={workflow} />}
      </div>}
      <nav aria-label="카테고리 목록" className={styles.collectionList}>
        {workflow.collections.map((collection) => <button key={collection.collectionId} type="button"
          aria-current={workflow.selectedCollectionId === collection.collectionId ? 'page' : undefined}
          onClick={(event) => onSelect(collection.collectionId, event.currentTarget)}>
          <span className={styles.collectionIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg>
          </span>
          <span className={styles.rowCopy}><strong>{collection.name}</strong>
            <small>장소 {collection.placeCount}개 · {visibilityLabel[collection.visibility]}</small>
            {collection.description && <span>{collection.description}</span>}
          </span><span aria-hidden="true">›</span>
        </button>)}
      </nav>
      {workflow.collectionNextCursor && <button className={styles.loadMore} type="button"
        disabled={workflow.loadingMoreCollections} onClick={() => void workflow.loadMoreCollections()}>
        {workflow.loadingMoreCollections ? '불러오는 중…' : '카테고리 더 보기'}
      </button>}
      <button className={styles.loadMore} type="button"
        onClick={(event) => onAllPlaces(event.currentTarget)}>모든 목록의 장소 검색</button>
      <div className={styles.management}><TagManagementPanel onAccessFailure={workflow.handleAccessFailure} onChanged={workflow.handleTagsChanged} /></div>
      <p className={styles.notice}>개인 메모·평점·방문 기록·개인 태그는 공개 목록에 포함되지 않습니다.</p>
    </div>
  </>
}

export function CollectionPlaces({ workflow, onSelect, onBack, onFilters }: Properties & Readonly<{
  onBack: () => void; onFilters: () => void
}>) {
  const [query, setQuery] = useState(workflow.placeQuery)
  useEffect(() => { setQuery(workflow.placeQuery) }, [workflow.placeQuery])
  const collection = workflow.selectedCollection
  const allPlaces = workflow.selectedCollectionId === undefined
  const rows = workflow.workspace?.places ?? []
  const filterCount = workflow.areaKeys.length + workflow.taxonomyKeys.length + workflow.tagIds.length + (workflow.ratingFilter === 'any' ? 0 : 1)
  const chips = [
    ...workflow.areaKeys.map((key) => ({ key, label: workflow.availableFilters?.areas.find((item) => item.key === key)?.label ?? '선택한 지역', remove: () => workflow.toggleArea(key) })),
    ...workflow.taxonomyKeys.map((key) => ({ key, label: workflow.taxonomyOptions.find((item) => item.key === key)?.label ?? '선택한 분류', remove: () => workflow.toggleTaxonomy(key) })),
    ...workflow.tagIds.map((key) => ({ key, label: `태그: ${workflow.tags.find((item) => item.tagId === key)?.name ?? '선택한 태그'}`, remove: () => workflow.toggleTag(key) })),
    ...(workflow.ratingFilter === 'any' ? [] : [{ key: 'rating', label: workflow.ratingFilter === 'rated' ? '내 평점 있음' : '내 평점 없음', remove: () => workflow.setRatingFilter('any') }]),
  ]
  return <>
    <header className={styles.panelHeader}>
      <button className={styles.backButton} onClick={onBack} type="button">← 내 목록</button>
      <span className={styles.eyebrow}>{collection ? visibilityLabel[collection.visibility] : '내 모든 카테고리'}</span>
      <h2 id="library-collection-heading" tabIndex={-1}>{allPlaces ? '전체 저장 장소' : collection?.name ?? '목록을 불러오는 중…'}</h2>
      {collection?.description && <p className={styles.description}>{collection.description}</p>}
      <form className={styles.search} role="search" aria-label="선택한 목록 안에서 장소 검색" onSubmit={(event) => {
        event.preventDefault(); workflow.setPlaceQuery(query.trim())
      }}>
        <label className={styles.srOnly} htmlFor="library-place-query">{allPlaces ? '내 모든 목록 안에서 장소 검색' : '이 목록 안에서 장소 검색'}</label>
        <input id="library-place-query" type="search" maxLength={160} placeholder={allPlaces ? '내 모든 목록 안에서 · 성수동 라멘' : '이 목록 안에서 · 성수동 라멘'}
          value={query ?? ''} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">검색</button>
      </form>
      <div className={styles.actions}><span>장소 {collection?.placeCount ?? workflow.availableFilters?.coverage.favoritePlaceCount ?? 0}개</span>
        <button id="library-filter-toggle" onClick={onFilters} type="button">필터{filterCount ? ` ${filterCount}` : ''}</button></div>
      {chips.length > 0 && <div className={styles.selectedFilters} aria-label="적용한 필터">
        {chips.slice(0, 3).map((chip) => <button aria-label={`${chip.label} 필터 해제`} key={chip.key} type="button" onClick={chip.remove}>{chip.label} ×</button>)}
        {chips.length > 3 && <button onClick={onFilters} type="button">+{chips.length - 3}</button>}
      </div>}
    </header>
    <div className={styles.scrollArea}>
      {workflow.collectionMessage && <p className={styles.inlineError} role="alert">{workflow.collectionMessage}</p>}
      {workflow.pageStatus === 'loading' ? <p className={styles.notice} role="status">장소를 불러오는 중…</p> : <>
        <div className={styles.listHeading}><strong>장소 목록</strong><span aria-live="polite">{rows.length}개 표시</span></div>
        {rows.length === 0 && <div className={styles.emptyState}>
          <strong>{workflow.workspace?.placeNextCursor ? '여기까지 확인한 장소에는 결과가 없습니다.' : '이 조건에 맞는 장소가 없습니다.'}</strong>
          <span>{workflow.workspace?.placeNextCursor ? '이어서 검색하면 다음 장소들을 확인합니다.' : '검색어나 필터를 바꾸거나 새로운 장소를 담아 보세요.'}</span>
          <a href="/">전체 카탈로그에서 장소 찾기</a>
        </div>}
        <ol className={styles.placeList}>{rows.map((row, index) => <li key={row.placeId}>
          <button type="button" aria-pressed={workflow.selectedPlaceId === row.placeId} onClick={(event) => onSelect(row.placeId, event.currentTarget)}>
            <span className={styles.placeNumber}>{index + 1}</span><span className={styles.rowCopy}>
              <strong>{row.place?.name ?? '장소 정보 준비 중'}</strong>
              <span>{row.place?.primaryTaxonomy?.label ?? '분류 미확인'} · {row.place?.areaLabel ?? '지역 정보 없음'}</span>
              <small>카테고리 {row.overlay.collectionCount}개 · {row.overlay.personalRating === null ? '내 평점 없음' : `내 평점 ${row.overlay.personalRating.toFixed(1)}`}</small>
            </span><span aria-hidden="true">›</span>
          </button>
        </li>)}</ol>
      </>}
      {workflow.workspace?.placeNextCursor && <button className={styles.loadMore} disabled={workflow.loadingMore} onClick={() => void workflow.loadMore()} type="button">
        {workflow.loadingMore ? '불러오는 중…' : rows.length === 0 ? '이어서 검색' : '장소 더 보기'}
      </button>}
      {collection && <details className={styles.management}><summary>카테고리 관리</summary>
        <form className={styles.creation} onSubmit={(event) => { event.preventDefault(); void workflow.renameCollection() }}>
          <label htmlFor="collection-rename">카테고리 이름 수정</label><div>
            <input id="collection-rename" maxLength={120} onChange={(event) => workflow.setRenameDraft(event.target.value)} value={workflow.renameDraft} />
            <button disabled={workflow.collectionMutation !== 'idle' || workflow.renameDraft.trim() === collection.name} type="submit">수정</button>
          </div>
        </form>
        <CollectionManagementPanel collection={collection} onAccessFailure={workflow.handleAccessFailure} onChanged={workflow.refresh} />
        {workflow.deleteArmed ? <div className={styles.deleteConfirm}>
          <span>카테고리만 삭제하며 장소의 다른 카테고리와 개인 기록은 유지됩니다.</span>
          <button disabled={workflow.collectionMutation !== 'idle'} onClick={() => void workflow.deleteCollection()} type="button">삭제 확인</button>
          <button disabled={workflow.collectionMutation !== 'idle'} onClick={workflow.cancelDelete} type="button">취소</button>
        </div> : <button className={styles.danger} onClick={workflow.armDelete} type="button">카테고리 삭제</button>}
      </details>}
    </div>
  </>
}
