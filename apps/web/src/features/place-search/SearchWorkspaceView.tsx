'use client'

import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

import styles from './search-workspace.module.css'
import type { SearchWorkspaceWorkflow } from './search-workspace-workflow'

export function SearchWorkspaceView({
  workflow,
}: Readonly<{ workflow: SearchWorkspaceWorkflow }>) {
  const {
    draftQuery,
    taxonomyKey,
    taxonomy,
    viewportBounds,
    searchBounds,
    items,
    nextCursor,
    selectedResultId,
    providerDetail,
    detailState,
    loading,
    loadingMore,
    error,
    mobileSurface,
    suggestions,
    suggestionState,
    suggestionOpen,
    activeSuggestionIndex,
    partial,
    suggestionPartial,
    selected,
    submitQuery,
    chooseSuggestion,
    changeDraftQuery,
    closeSuggestions,
    openSuggestions,
    moveSuggestion,
    showMobileSurface,
    selectTaxonomy,
    searchViewport,
    retrySearch,
    loadMore,
    selectResult,
    panViewport,
  } = workflow

  return (
    <section aria-labelledby="place-search-title" className={styles.workspace}>
      <header className={styles.searchHeader}>
        <div>
          <p className={styles.eyebrow}>내 장소와 공개 장소</p>
          <h1 id="place-search-title">장소 찾기</h1>
        </div>
        <div aria-label="모바일 보기 선택" className={styles.mobileToggle}>
          <button aria-pressed={mobileSurface === 'list'} onClick={() => showMobileSurface('list')} type="button">목록</button>
          <button aria-pressed={mobileSurface === 'map'} onClick={() => showMobileSurface('map')} type="button">지도</button>
        </div>
      </header>

      <form className={styles.controls} onSubmit={(event) => {
        event.preventDefault()
        submitQuery(draftQuery)
      }}>
        <label className={styles.queryField}>
          <span>검색어</span>
          <div className={styles.combobox}>
            <input
              aria-activedescendant={suggestionOpen && suggestions[activeSuggestionIndex] !== undefined
                ? `place-suggestion-${suggestions[activeSuggestionIndex].suggestionId}`
                : undefined}
              aria-autocomplete="list"
              aria-controls="place-suggestions"
              aria-expanded={suggestionOpen}
              aria-label="장소 검색어"
              onBlur={() => window.setTimeout(() => closeSuggestions(), 100)}
              onChange={(event) => {
                changeDraftQuery(event.target.value)
              }}
              onFocus={() => {
                openSuggestions()
              }}
              onKeyDown={(event) => {
                if (!suggestionOpen || suggestions.length === 0) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveSuggestion(1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveSuggestion(-1)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const suggestion = suggestions[activeSuggestionIndex]
                  if (suggestion !== undefined) void chooseSuggestion(suggestion)
                } else if (event.key === 'Escape') {
                  closeSuggestions()
                }
              }}
              placeholder="이름, 지역, 분류로 검색"
              role="combobox"
              type="search"
              value={draftQuery}
            />
            {suggestionOpen && (
              <div className={styles.suggestionPanel}>
                {suggestionState === 'loading' && <p role="status">장소를 찾는 중…</p>}
                {suggestionState === 'unavailable' && (
                  <p role="status">자동완성을 사용할 수 없습니다. 검색어 그대로 전체 검색할 수 있습니다.</p>
                )}
                {suggestionState === 'ready' && suggestions.length === 0 && (
                  <p role="status">일치하는 후보가 없습니다. Enter로 전체 검색해 보세요.</p>
                )}
                {suggestions.length > 0 && (
                  <ul aria-label="장소 자동완성" id="place-suggestions" role="listbox">
                    {suggestions.map((suggestion, index) => (
                      <li
                        aria-selected={index === activeSuggestionIndex}
                        id={`place-suggestion-${suggestion.suggestionId}`}
                        key={suggestion.suggestionId}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          void chooseSuggestion(suggestion)
                        }}
                        role="option"
                      >
                        <strong>{suggestion.name}</strong>
                        <span>{suggestion.areaLabel ?? '지역 정보 없음'} · {suggestion.categoryLabel ?? '분류 미확인'}</span>
                        <small>{suggestion.identity.kind === 'canonical' ? '내 장소 데이터' : suggestion.source.label}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {suggestionPartial && <p className={styles.suggestionNotice}>일부 출처의 후보가 지연되거나 누락됐습니다.</p>}
              </div>
            )}
          </div>
        </label>
        <label className={styles.filterField}>
          <span>분류</span>
          <select aria-label="장소 분류" onChange={(event) => selectTaxonomy(event.target.value)} value={taxonomyKey}>
            <option value="">전체 분류</option>
            {taxonomy.filter((node) => node.kind === 'category').map((node) => (
              <option key={node.key} value={node.key}>{node.label}</option>
            ))}
          </select>
        </label>
        <button className={styles.searchButton} type="submit">검색</button>
        <button
          className={styles.boundsButton}
          disabled={searchBounds !== undefined && JSON.stringify(searchBounds) === JSON.stringify(viewportBounds)}
          onClick={() => searchViewport()}
          type="button"
        >
          이 영역 검색
        </button>
      </form>

      {partial && <p className={styles.notice} role="status">일부 검색 소스의 결과가 지연되거나 누락되었습니다.</p>}
      {error !== undefined && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button onClick={() => void retrySearch()} type="button">다시 시도</button>
        </div>
      )}

      <div className={styles.content}>
        <section className={`${styles.results} ${mobileSurface === 'map' ? styles.mobileHidden : ''}`}>
          <div className={styles.resultMeta}>
            <span>{loading ? '검색 중…' : `${items.length}개 결과`}</span>
            {searchBounds !== undefined && <span>지도 영역 적용됨</span>}
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
          {selected !== undefined && (
            <aside className={selected.identity.kind === 'provider' ? `${styles.selection} ${styles.providerSelection}` : styles.selection} aria-live="polite">
              {selected.identity.kind === 'canonical' ? (
                <><span>선택한 장소</span><strong>{selected.name}</strong></>
              ) : (
                <>
                  <div className={styles.selectionHeading}>
                    <span>선택한 장소</span><strong>{selected.name}</strong>
                  </div>
                  <div className={styles.selectionActions}>
                    <span>공급자에서 방금 확인</span>
                    {selected.source.externalUri !== undefined && (
                      <a href={selected.source.externalUri} rel="noreferrer" target="_blank">
                        {selected.source.label}에서 열기
                      </a>
                    )}
                  </div>
                  {detailState === 'loading' && <span className={styles.detailStatus}>최신 상세를 확인하는 중…</span>}
                  {detailState === 'unavailable' && <span className={styles.detailStatus}>상세 정보는 지금 불러올 수 없습니다.</span>}
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
                </>
              )}
            </aside>
          )}
        </section>

        <div className={`${styles.mapPane} ${mobileSurface === 'list' ? styles.mobileHidden : ''}`}>
          <DeterministicPlaceMap
            bounds={viewportBounds}
            onPan={() => panViewport()}
            onSelect={selectResult}
            results={items}
            selectedResultId={selectedResultId}
          />
        </div>
      </div>
    </section>
  )
}
