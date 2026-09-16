'use client'

import { useEffect, useRef, useState } from 'react'
import type { CatalogPlaceSearchResponse, CatalogPlaceSummary } from '@place/contracts/search'
import type { PublicPlaceDetailResponse } from '@place/contracts/places'
import { createCatalogClient, type CatalogClient } from './catalog-client'
import styles from './catalog-inspection.module.css'

const evidenceLabels = { verified: '검증됨', unverified: '미검증', conflicted: '근거 충돌', stale: '오래된 근거' }
const defaultClient = createCatalogClient()

export function CatalogInspection({ client = defaultClient }: Readonly<{ client?: CatalogClient }>) {
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [page, setPage] = useState<CatalogPlaceSearchResponse>()
  const [rows, setRows] = useState<readonly CatalogPlaceSummary[]>([])
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<PublicPlaceDetailResponse>()
  const [searching, setSearching] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [detailError, setDetailError] = useState('')
  const searchRequest = useRef<AbortController | undefined>(undefined)
  const detailRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { searchRequest.current?.abort(); detailRequest.current?.abort() }, [])

  async function search(more = false) {
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    setSearching(true); setSearchError('')
    if (!more) {
      detailRequest.current?.abort()
      setSelected(undefined); setDetail(undefined); setLoadingDetail(false); setDetailError('')
      setPage(undefined); setRows([])
    }
    try {
      const next = await client.search(more ? searchedQuery : query, more ? page?.nextCursor : undefined, controller.signal)
      if (controller.signal.aborted) return
      setPage(next)
      setRows((previous) => more ? [...previous, ...next.items.filter((item) => !previous.some((row) => row.placeId === item.placeId))] : next.items)
      if (!more) setSearchedQuery(query)
    } catch (error) {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : '조회에 실패했습니다.')
    } finally { if (!controller.signal.aborted) setSearching(false) }
  }
  async function select(placeId: string) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setSelected(placeId); setDetail(undefined); setDetailError(''); setLoadingDetail(true)
    try {
      const next = await client.detail(placeId, controller.signal)
      if (!controller.signal.aborted) setDetail(next)
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : '조회에 실패했습니다.')
    } finally { if (!controller.signal.aborted) setLoadingDetail(false) }
  }

  return <section className={styles.catalog} aria-label="장소 데이터 조회">
    <p className={styles.notice}>내부 카탈로그에 공개 투영된 장소만 조회합니다. 외부 실시간 검색·개인 메모·원본 수집 데이터·장소 변경은 제공하지 않습니다.</p>
    <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void search() }}>
      <label htmlFor="catalog-query">장소·지역·분류 검색</label>
      <input id="catalog-query" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 서울 라멘" />
      <button type="submit">검색</button>
    </form>
    <div className={styles.panes}>
      <section className={styles.results} aria-label="검색 결과" aria-busy={searching}>
        <h2>장소 목록 <small>{rows.length}개 표시</small></h2>
        {searchError && <p role="alert">{searchError}</p>}
        {searching && <p role="status">조회 중입니다.</p>}
        {!searching && page === undefined && !searchError && <p>검색어를 입력하거나 빈 검색으로 카탈로그를 조회하세요.</p>}
        {!searching && page !== undefined && rows.length === 0 && <p>조건에 맞는 공개 장소가 없습니다.</p>}
        <ul>{rows.map((item) => <li key={item.placeId}><button className={selected === item.placeId ? styles.selected : ''}
          aria-pressed={selected === item.placeId} onClick={() => void select(item.placeId)} type="button">
          <strong>{item.name}</strong><span>{item.area?.label ?? '지역 정보 없음'} · {item.primaryTaxonomy?.label ?? '미분류'}</span>
          <small>{evidenceLabels[item.evidenceStatus]}</small>
        </button></li>)}</ul>
        {page?.nextCursor && <button disabled={searching} onClick={() => void search(true)} type="button">더 보기</button>}
      </section>
      <section className={styles.detail} aria-label="선택한 장소 상세" aria-busy={loadingDetail}>
        <h2>장소 상세</h2>
        {loadingDetail && <p role="status">상세 조회 중입니다.</p>}
        {detailError && <div role="alert"><p>{detailError}</p><button onClick={() => selected && void select(selected)} type="button">다시 조회</button></div>}
        {!selected && <p>왼쪽 목록에서 장소를 선택하세요.</p>}
        {detail && <><h3>{detail.name}</h3><dl>
          <dt>장소 ID</dt><dd>{detail.placeId}</dd>
          <dt>지역</dt><dd>{detail.areaLabel ?? '정보 없음'}</dd>
          <dt>대표 분류</dt><dd>{detail.primaryTaxonomy?.label ?? '미분류'}</dd>
          <dt>분류 키</dt><dd>{detail.taxonomyKeys.join(', ') || '없음'}</dd>
          <dt>좌표</dt><dd>{detail.location ? `${detail.location.latitude}, ${detail.location.longitude}` : '정보 없음'}</dd>
          <dt>근거 상태</dt><dd>{evidenceLabels[detail.evidence.status]}</dd>
          <dt>투영 시각</dt><dd><time dateTime={detail.evidence.projectedAt}>{detail.evidence.projectedAt}</time></dd>
        </dl>{detail.status === 'redirected' && <p>통합된 현재 장소로 연결되었습니다.</p>}</>}
      </section>
    </div>
  </section>
}
