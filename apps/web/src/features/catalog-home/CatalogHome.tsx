'use client'

import { Component, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'

import { ExternalDirectionActions, type PlaceMapRenderer } from '../../platform/maps/public'

import {
  catalogQuickTypes,
  type CatalogHomePlace,
  type CatalogHomeWorkflow,
  useCatalogHome,
} from './catalog-home-workflow'
import styles from './catalog-home.module.css'

const evidenceLabels = {
  verified: '검증됨', unverified: '검토 전', conflicted: '정보 충돌', stale: '갱신 필요',
  unknown: '',
} as const

export type CatalogHomePlaceFilingRenderer = ComponentType<Readonly<{
  onAccessFailure: (status: number) => void
  onApplied: () => Promise<unknown>
  placeId: string | undefined
}>>

export function CatalogHomeSearch() {
  return <CatalogSearchInput workflow={useCatalogHome()} />
}

function CatalogSearchInput({ workflow, onSearch }: Readonly<{ workflow: CatalogHomeWorkflow; onSearch?: () => void }>) {
  return (
    <form
      className={styles.search}
      onSubmit={(event) => { event.preventDefault(); onSearch?.(); workflow.submitSearch() }}
      role="search"
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
        <circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" />
      </svg>
      <input
        aria-label="곳곳간 카탈로그 검색"
        onChange={(event) => workflow.changeDraftQuery(event.target.value)}
        placeholder="성수동 라멘, 지역이나 장소 검색"
        value={workflow.draftQuery}
      />
      <button aria-label="카탈로그 검색 실행" type="submit">검색</button>
    </form>
  )
}

class MapBoundary extends Component<Readonly<{ children: ReactNode }>, Readonly<{ failed: boolean }>> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override componentDidCatch(_error: Error, _info: ErrorInfo) {}
  override render() {
    return this.state.failed
      ? <MapAlternative message="지도를 불러오지 못했습니다. 왼쪽 목록과 컬렉션 정리는 계속 사용할 수 있어요." />
      : this.props.children
  }
}

function MapAlternative({ message }: Readonly<{ message: string }>) {
  return (
    <section aria-label="지도 대체 화면" className={styles.mapAlternative} role="status">
      <span aria-hidden="true">⌖</span>
      <strong>목록으로 계속 탐색할 수 있어요</strong>
      <p>{message}</p>
    </section>
  )
}

function CollectionChooser({ PlaceFilingRenderer, workflow }: Readonly<{
  PlaceFilingRenderer: CatalogHomePlaceFilingRenderer
  workflow: CatalogHomeWorkflow
}>) {
  if (!workflow.collectionPickerOpen) return null
  if (workflow.collectionState === 'loading') return <p className={styles.pickerState}>컬렉션을 불러오는 중입니다.</p>
  if (workflow.collectionState === 'signed-out') {
    return <p className={styles.pickerState}><a href="/api/auth/oidc/start">로그인</a>하면 내 컬렉션을 선택할 수 있습니다.</p>
  }
  if (workflow.collectionState === 'unavailable') return <p className={styles.pickerState}>컬렉션을 불러오지 못했습니다.</p>
  if (workflow.collections.length === 0) return <p className={styles.pickerState}><a href="/library">내 곳곳간</a>에서 컬렉션을 먼저 만들어 주세요.</p>
  return (
    <div aria-label="정리할 컬렉션 선택" className={styles.collectionPicker}>
      <PlaceFilingRenderer
        onAccessFailure={workflow.onFilingAccessFailure}
        onApplied={workflow.onFilingApplied}
        placeId={workflow.selected?.placeId}
      />
    </div>
  )
}

function ResultRow({ place, index, selected, onSelect }: Readonly<{
  place: CatalogHomePlace
  index: number
  selected: boolean
  onSelect: () => void
}>) {
  return (
    <li>
      <button aria-pressed={selected} data-catalog-place={place.placeId} className={selected ? styles.selectedResult : styles.result} onClick={onSelect} type="button">
        <span aria-hidden="true" className={styles.resultIndex}>{index + 1}</span>
        <span className={styles.resultBody}>
          <strong>{place.name}</strong>
          <span>{[place.areaLabel, place.taxonomyLabel].filter(Boolean).join(' · ') || '분류 정보 없음'}</span>
          <small>{[evidenceLabels[place.evidenceStatus], place.location === null ? '지도 좌표 없음' : ''].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
    </li>
  )
}

function SearchResults({ workflow }: Readonly<{ workflow: CatalogHomeWorkflow }>) {
  return (
    <section className={styles.resultsSection}>
      <div className={styles.sectionHeading}>
        <h2>검색 결과</h2>
        {workflow.searchState === 'ready' && <span>{workflow.items.length}곳</span>}
      </div>
      <div aria-live="polite">
        {workflow.searchState === 'idle' && <p className={styles.searchPrompt}>지역과 장소 유형을 검색해 곳곳간의 통합 카탈로그를 탐색해 보세요.</p>}
        {workflow.searchState === 'loading' && <p className={styles.searchPrompt}>카탈로그를 검색하고 있습니다.</p>}
        {workflow.searchState === 'unavailable' && <p className={styles.searchError}>{workflow.searchError}</p>}
        {workflow.searchState === 'ready' && workflow.items.length === 0 && <p className={styles.searchPrompt}>조건에 맞는 장소가 없습니다.</p>}
      </div>
      {workflow.items.length > 0 && (
        <ol className={styles.resultsList}>
          {workflow.items.map((place, index) => (
            <ResultRow
              index={index}
              key={place.placeId}
              onSelect={() => workflow.selectPlace(place.placeId)}
              place={place}
              selected={place.placeId === workflow.selected?.placeId}
            />
          ))}
        </ol>
      )}
      {workflow.nextCursor !== undefined && (
        <button
          className={styles.loadMore}
          disabled={workflow.paginationState === 'loading'}
          onClick={workflow.loadMore}
          type="button"
        >{workflow.paginationState === 'loading' ? '더 불러오는 중' : '장소 더 보기'}</button>
      )}
      {workflow.paginationState === 'unavailable' && (
        <p className={styles.paginationError}>다음 장소를 불러오지 못했습니다. 장소 더 보기를 다시 눌러 주세요.</p>
      )}
    </section>
  )
}

function SelectedPlaceCard({ PlaceFilingRenderer, workflow }: Readonly<{
  PlaceFilingRenderer: CatalogHomePlaceFilingRenderer
  workflow: CatalogHomeWorkflow
}>) {
  if (workflow.selected === undefined) return null
  return (
    <section aria-label="선택한 장소" className={styles.selectedCard}>
      <div>
        <span>{workflow.selected.taxonomyLabel ?? '장소'}</span>
        <h2>{workflow.selected.name}</h2>
        <p>{[workflow.selected.areaLabel ?? '지역 정보 없음', evidenceLabels[workflow.selected.evidenceStatus]].filter(Boolean).join(' · ')}</p>
      </div>
      <button
        aria-expanded={workflow.collectionPickerOpen}
        className={styles.fileButton}
        onClick={() => workflow.setCollectionPickerOpen(!workflow.collectionPickerOpen)}
        type="button"
      >컬렉션 선택</button>
      <ExternalDirectionActions destination={workflow.selected} />
      <CollectionChooser PlaceFilingRenderer={PlaceFilingRenderer} workflow={workflow} />
    </section>
  )
}

export function CatalogHomeView({ MapRenderer, PlaceFilingRenderer, workflow }: Readonly<{
  MapRenderer: PlaceMapRenderer
  PlaceFilingRenderer: CatalogHomePlaceFilingRenderer
  workflow: CatalogHomeWorkflow
}>) {
  const [collapsed, setCollapsed] = useState(false)
  const [detailOpen, setDetailOpen] = useState(workflow.selected !== undefined)
  const [typesOpen, setTypesOpen] = useState(false)
  const [typeQuery, setTypeQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const detailTitle = useRef<HTMLButtonElement>(null)
  const scrollPosition = useRef(0)
  const returnFocusPlaceId = useRef<string | undefined>(workflow.selected?.placeId)
  const selectPlace = (placeId: string) => {
    if (!detailOpen) {
      scrollPosition.current = listRef.current?.scrollTop ?? scrollPosition.current
      returnFocusPlaceId.current = placeId
    }
    workflow.selectPlace(placeId)
    setDetailOpen(true)
    setCollapsed(false)
    window.requestAnimationFrame(() => detailTitle.current?.focus())
  }
  const backToResults = () => {
    setDetailOpen(false)
    window.requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = scrollPosition.current
        const rows = listRef.current.querySelectorAll<HTMLElement>('[data-catalog-place]')
        Array.from(rows).find((row) => row.dataset.catalogPlace === returnFocusPlaceId.current)?.focus({ preventScroll: true })
      }
    })
  }
  const initialCameraMode = workflow.searchState === 'idle' &&
    workflow.draftQuery.length === 0 && workflow.submittedQuery.length === 0 &&
    workflow.selectedQuickType === null ? 'granted-current-location' : 'supplied-bounds'
  return <div className={styles.home} data-collapsed={collapsed}>
    <aside aria-label="카탈로그 탐색 패널" className={styles.listPane} hidden={collapsed}>
      <div className={styles.panelHeader}>
        <span className={styles.eyebrow}>CATALOG</span>
        <h2>어떤 곳을 찾으세요?</h2>
        <CatalogSearchInput workflow={workflow} onSearch={() => setDetailOpen(false)} />
        <div className={styles.toolbar}>
          <button aria-expanded={typesOpen} aria-controls="catalog-types" onClick={() => setTypesOpen(!typesOpen)} type="button">장소 유형{workflow.selectedQuickType ? ' · 1' : ''}</button>
          <span>곳곳간 내부 장소 검색</span>
        </div>
        {typesOpen && <section aria-label="장소 유형 선택" id="catalog-types" className={styles.typePicker}>
          <input aria-label="장소 유형 찾기" placeholder="유형 찾기" value={typeQuery} onChange={(event) => setTypeQuery(event.target.value)} />
          <div>{catalogQuickTypes.filter((type) => type.includes(typeQuery.trim())).map((type) =>
            <button aria-pressed={workflow.selectedQuickType === type} key={type} onClick={() => {
              workflow.toggleQuickType(type); setDetailOpen(false); setTypesOpen(false)
            }} type="button">{type}</button>)}</div>
          <small>세부 음식명은 검색어에 함께 입력해 주세요.</small>
        </section>}
        <div className={styles.interpretation}>
          {workflow.selectedQuickType && <button onClick={() => { workflow.toggleQuickType(workflow.selectedQuickType!); setDetailOpen(false) }} type="button">{workflow.selectedQuickType} ×</button>}
          {workflow.interpretation.map((token) => <button key={token.tokenId} onClick={() => { workflow.excludeToken(token.tokenId); setDetailOpen(false) }} type="button">
            {token.label}<span aria-hidden="true"> ×</span><span className={styles.srOnly}> 조건 제거</span>
          </button>)}
        </div>
      </div>
      <div className={styles.panelBody} ref={listRef}>
        {detailOpen && workflow.selected ? <>
          <button className={styles.backButton} onClick={backToResults} ref={detailTitle} type="button">← 검색 결과로</button>
          <SelectedPlaceCard PlaceFilingRenderer={PlaceFilingRenderer} workflow={workflow} />
        </> : <SearchResults workflow={{ ...workflow, selectPlace }} />}
      </div>
    </aside>
    <section aria-label="카탈로그 지도와 선택한 장소" className={styles.mapPane}>
      <MapBoundary><MapRenderer
        ariaLabel="곳곳간 카탈로그 검색 지도"
        bounds={workflow.viewport.bounds} clusters={workflow.mapClusters}
        description={workflow.mapDescription} initialCameraMode={initialCameraMode}
        markers={workflow.mapMarkers} onClusterSelect={workflow.selectMapCluster}
        onSelect={selectPlace} onViewportChange={workflow.setViewport}
        selectedMarkerId={workflow.selected?.placeId} title="카탈로그 장소" zoom={workflow.viewport.zoom}
      /></MapBoundary>
      {workflow.mapState === 'unavailable' && <p className={styles.mapNotice} role="status">장소 표시를 불러오지 못했습니다. 목록에서 다시 검색해 주세요.</p>}
    </section>
    <button aria-label={collapsed ? '탐색 패널 펼치기' : '탐색 패널 접기'}
      aria-expanded={!collapsed} className={styles.collapseButton}
      onClick={() => setCollapsed(!collapsed)} type="button">
      <span aria-hidden="true">{collapsed ? '›' : '‹'}</span><span>{collapsed ? '목록 보기' : '지도 넓게'}</span>
    </button>
  </div>
}

export function CatalogHomeWorkspace({ MapRenderer, PlaceFilingRenderer }: Readonly<{
  MapRenderer: PlaceMapRenderer
  PlaceFilingRenderer: CatalogHomePlaceFilingRenderer
}>) {
  return <CatalogHomeView MapRenderer={MapRenderer} PlaceFilingRenderer={PlaceFilingRenderer} workflow={useCatalogHome()} />
}
