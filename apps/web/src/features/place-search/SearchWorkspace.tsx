'use client'

import {
  placeSearchResponseSchema,
  taxonomyProjectionSchema,
  type PlaceSearchRequest,
  type PlaceSearchResult,
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
  const [taxonomyKey, setTaxonomyKey] = useState('')
  const [taxonomy, setTaxonomy] = useState<readonly TaxonomyNode[]>([])
  const [viewportBounds, setViewportBounds] = useState<SearchBounds>(initialBounds)
  const [searchBounds, setSearchBounds] = useState<SearchBounds | undefined>()
  const [items, setItems] = useState<readonly PlaceSearchResult[]>([])
  const [sources, setSources] = useState<readonly { sourceKey: string; status: 'complete' | 'partial' | 'unavailable'; resultCount: number; errorCode?: string }[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [mobileSurface, setMobileSurface] = useState<'list' | 'map'>('list')
  const requestSequence = useRef(0)

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
    query: draftQuery,
    filters: { taxonomyKeys: taxonomyKey === '' ? [] : [taxonomyKey] },
    limit: 3,
    ...(searchBounds === undefined ? {} : { bounds: searchBounds }),
  }), [draftQuery, searchBounds, taxonomyKey])

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
        setSelectedPlaceId((selectedPlace) =>
          selectedPlace !== undefined && available.some((item) => item.placeId === selectedPlace)
            ? selectedPlace
            : available[0]?.placeId,
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

  const partial = sources.some((source) => source.status !== 'complete')
  const selected = items.find((item) => item.placeId === selectedPlaceId)

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

      <div className={styles.controls}>
        <label className={styles.queryField}>
          <span>검색어</span>
          <input
            aria-label="장소 검색어"
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="이름, 지역, 분류로 검색"
            type="search"
            value={draftQuery}
          />
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
        <button
          className={styles.boundsButton}
          disabled={searchBounds !== undefined && JSON.stringify(searchBounds) === JSON.stringify(viewportBounds)}
          onClick={() => setSearchBounds(viewportBounds)}
          type="button"
        >
          이 영역 검색
        </button>
      </div>

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
              <li key={item.placeId}>
                <button
                  aria-pressed={item.placeId === selectedPlaceId}
                  className={item.placeId === selectedPlaceId ? `${styles.resultRow} ${styles.selectedRow}` : styles.resultRow}
                  onClick={() => setSelectedPlaceId(item.placeId)}
                  type="button"
                >
                  <span className={styles.resultNumber}>{index + 1}</span>
                  <span className={styles.resultText}>
                    <strong>{item.name}</strong>
                    <span>{item.primaryTaxonomy?.label ?? '분류 미확인'} · {item.areaLabel ?? '지역 정보 없음'}</span>
                    <span className={styles.evidence}>{item.evidenceStatus === 'verified' ? '검증됨' : '확인 필요'} · 로컬 색인</span>
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
            <aside className={styles.selection} aria-live="polite">
              <span>선택한 장소</span><strong>{selected.name}</strong>
            </aside>
          )}
        </section>

        <div className={`${styles.mapPane} ${mobileSurface === 'list' ? styles.mobileHidden : ''}`}>
          <DeterministicPlaceMap
            bounds={viewportBounds}
            onPan={() => setViewportBounds((current) => movedEast(current))}
            onSelect={setSelectedPlaceId}
            results={items}
            selectedPlaceId={selectedPlaceId}
          />
        </div>
      </div>
    </section>
  )
}
