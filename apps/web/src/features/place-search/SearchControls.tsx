'use client'

import styles from './search-controls.module.css'
import type { SearchControlsInterface } from './search-workspace-interface'

export function SearchControls({
  controls,
}: Readonly<{ controls: SearchControlsInterface }>) {
  const {
    draftQuery,
    taxonomyKey,
    taxonomy,
    suggestions,
    suggestionState,
    suggestionOpen,
    activeSuggestionIndex,
    partial,
    suggestionPartial,
    error,
    searchViewportDisabled,
    submitQuery,
    chooseSuggestion,
    changeDraftQuery,
    closeSuggestions,
    openSuggestions,
    moveSuggestion,
    selectTaxonomy,
    searchViewport,
    retrySearch,
  } = controls

  return (
    <>
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
              onChange={(event) => changeDraftQuery(event.target.value)}
              onFocus={openSuggestions}
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
          disabled={searchViewportDisabled}
          onClick={searchViewport}
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
    </>
  )
}
