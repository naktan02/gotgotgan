'use client'

import {
  placeSearchResponseSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsResponseSchema,
  providerPlaceDetailSchema,
  taxonomyProjectionSchema,
  type PlaceSearchRequest,
  type PlaceSearchResult,
  type PlaceSuggestion,
  type ProviderPlaceDetail,
  type SearchBounds,
  type TaxonomyNode,
} from '@place/contracts/search'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

import styles from './search-workspace.module.css'

const initialBounds: SearchBounds = {
  west: 126.96, south: 37.48, east: 127.15, north: 37.61,
}

function movedEast(bounds: SearchBounds): SearchBounds {
  const distance = (bounds.east - bounds.west) * 0.8
  return { ...bounds, west: bounds.west + distance, east: bounds.east + distance }
}

async function jsonOrThrow(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error('검색 응답을 사용할 수 없습니다.')
  }
  return response.json()
}

export function SearchWorkspace() {
  const [draftQuery, setDraftQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [taxonomyKey, setTaxonomyKey] = useState('')
  const [taxonomy, setTaxonomy] = useState<readonly TaxonomyNode[]>([])
  const [viewportBounds, setViewportBounds] = useState<SearchBounds>(initialBounds)
  const [searchBounds, setSearchBounds] = useState<SearchBounds | undefined>()
  const [items, setItems] = useState<readonly PlaceSearchResult[]>([])
  const [sources, setSources] = useState<readonly { sourceKey: string; status: 'complete' | 'partial' | 'unavailable'; resultCount: number; errorCode?: string }[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [selectedResultId, setSelectedResultId] = useState<string | undefined>()
  const [providerDetail, setProviderDetail] = useState<ProviderPlaceDetail | undefined>()
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'unavailable'>('idle')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [mobileSurface, setMobileSurface] = useState<'list' | 'map'>('list')
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestion[]>([])
  const [suggestionSources, setSuggestionSources] = useState<readonly { status: 'complete' | 'partial' | 'unavailable' }[]>([])
  const [suggestionState, setSuggestionState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const requestSequence = useRef(0)
  const suggestionSequence = useRef(0)
  const suggestionSessionId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/search/taxonomy', { cache: 'no-store', signal: controller.signal })
      .then(jsonOrThrow)
      .then((payload) => setTaxonomy(taxonomyProjectionSchema.parse(payload).nodes))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setTaxonomy([])
      })
    return () => controller.abort()
  }, [])

  const baseRequest = useMemo<PlaceSearchRequest>(() => ({
    schemaVersion: 'place-search.v1',
    query: submittedQuery,
    filters: { taxonomyKeys: taxonomyKey === '' ? [] : [taxonomyKey] },
    limit: 8,
    ...(searchBounds === undefined ? {} : { bounds: searchBounds }),
  }), [searchBounds, submittedQuery, taxonomyKey])

  const executeSearch = useCallback(async (
    request: PlaceSearchRequest,
    append: boolean,
    signal?: AbortSignal,
  ) => {
    const sequence = ++requestSequence.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(undefined)
    if (!append) {
      setSources([])
      setNextCursor(undefined)
    }
    try {
      const response = await fetch('/api/search/places', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        cache: 'no-store',
        signal,
      })
      const payload = placeSearchResponseSchema.parse(await jsonOrThrow(response))
      if (sequence !== requestSequence.current) return
      setItems((current) => {
        const available = append ? [...current, ...payload.items] : payload.items
        setSelectedResultId((selectedResult) =>
          selectedResult !== undefined && available.some((item) => item.resultId === selectedResult)
            ? selectedResult
            : available[0]?.resultId,
        )
        return available
      })
      setSources(payload.sources)
      setNextCursor(payload.nextCursor)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      if (sequence === requestSequence.current) {
        if (!append) setItems([])
        setError('검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.')
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void executeSearch(baseRequest, false, controller.signal)
    }, 300)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [baseRequest, executeSearch])

  useEffect(() => {
    const query = draftQuery.normalize('NFKC').replace(/\s+/g, ' ').trim()
    if (query.length === 0 || query === submittedQuery) {
      setSuggestions([])
      setSuggestionSources([])
      setSuggestionOpen(false)
      setSuggestionState('idle')
      return
    }
    const sequence = ++suggestionSequence.current
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSuggestionState('loading')
      fetch('/api/search/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'place-suggestions.v1',
          query,
          limit: 8,
          bounds: viewportBounds,
          ...(suggestionSessionId.current === undefined
            ? {}
            : { sessionId: suggestionSessionId.current }),
        }),
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(jsonOrThrow)
        .then((payload) => {
          if (sequence !== suggestionSequence.current) return
          const parsed = placeSuggestionsResponseSchema.parse(payload)
          suggestionSessionId.current = parsed.sessionId
          setSuggestions(parsed.items)
          setSuggestionSources(parsed.sources)
          setActiveSuggestionIndex(0)
          setSuggestionOpen(true)
          setSuggestionState('ready')
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          if (sequence === suggestionSequence.current) {
            setSuggestions([])
            setSuggestionSources([])
            setSuggestionOpen(true)
            setSuggestionState('unavailable')
          }
        })
    }, 180)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [draftQuery, submittedQuery, viewportBounds])

  const submitQuery = useCallback((query: string) => {
    const normalized = query.normalize('NFKC').replace(/\s+/g, ' ').trim()
    setDraftQuery(normalized)
    setSubmittedQuery(normalized)
    setSuggestions([])
    setSuggestionOpen(false)
  }, [])

  const chooseSuggestion = useCallback(async (suggestion: PlaceSuggestion) => {
    try {
      const response = await fetch('/api/search/suggestion-selections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 'place-suggestion-selection.v1',
          suggestionId: suggestion.suggestionId,
        }),
        cache: 'no-store',
      })
      placeSuggestionSelectionResponseSchema.parse(await jsonOrThrow(response))
      submitQuery(suggestion.name)
    } catch {
      setSuggestionState('unavailable')
    }
  }, [submitQuery])

  const partial = sources.some((source) => source.status !== 'complete')
  const suggestionPartial = suggestionSources.some((source) => source.status !== 'complete')
  const selected = items.find((item) => item.resultId === selectedResultId)

  useEffect(() => {
    setProviderDetail(undefined)
    setDetailState('idle')
    if (
      selected?.identity.kind !== 'provider' || !selected.source.detailsAvailable ||
      selected.identity.providerPlaceId === undefined
    ) return
    const controller = new AbortController()
    setDetailState('loading')
    fetch('/api/search/provider-details', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 'place-provider-detail.v1',
        providerKey: selected.identity.providerKey,
        providerPlaceId: selected.identity.providerPlaceId,
      }),
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(jsonOrThrow)
      .then((payload) => {
        setProviderDetail(providerPlaceDetailSchema.parse(payload))
        setDetailState('idle')
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setDetailState('unavailable')
        }
      })
    return () => controller.abort()
  }, [selected])

  return (
    <section aria-labelledby="place-search-title" className={styles.workspace}>
      <header className={styles.searchHeader}>
        <div>
          <p className={styles.eyebrow}>내 장소와 공개 장소</p>
          <h1 id="place-search-title">장소 찾기</h1>
        </div>
        <div aria-label="모바일 보기 선택" className={styles.mobileToggle}>
          <button aria-pressed={mobileSurface === 'list'} onClick={() => setMobileSurface('list')} type="button">목록</button>
          <button aria-pressed={mobileSurface === 'map'} onClick={() => setMobileSurface('map')} type="button">지도</button>
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
              onBlur={() => window.setTimeout(() => setSuggestionOpen(false), 100)}
              onChange={(event) => {
                setDraftQuery(event.target.value)
                setActiveSuggestionIndex(0)
              }}
              onFocus={() => {
                if (suggestionState === 'ready' || suggestionState === 'unavailable') setSuggestionOpen(true)
              }}
              onKeyDown={(event) => {
                if (!suggestionOpen || suggestions.length === 0) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveSuggestionIndex((index) => (index + 1) % suggestions.length)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const suggestion = suggestions[activeSuggestionIndex]
                  if (suggestion !== undefined) void chooseSuggestion(suggestion)
                } else if (event.key === 'Escape') {
                  setSuggestionOpen(false)
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
          <select aria-label="장소 분류" onChange={(event) => setTaxonomyKey(event.target.value)} value={taxonomyKey}>
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
          onClick={() => setSearchBounds(viewportBounds)}
          type="button"
        >
          이 영역 검색
        </button>
      </form>

      {partial && <p className={styles.notice} role="status">일부 검색 소스의 결과가 지연되거나 누락되었습니다.</p>}
      {error !== undefined && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button onClick={() => void executeSearch(baseRequest, false)} type="button">다시 시도</button>
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
                  onClick={() => setSelectedResultId(item.resultId)}
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
              onClick={() => void executeSearch({ ...baseRequest, cursor: nextCursor }, true)}
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
            onPan={() => setViewportBounds((current) => movedEast(current))}
            onSelect={setSelectedResultId}
            results={items}
            selectedResultId={selectedResultId}
          />
        </div>
      </div>
    </section>
  )
}
