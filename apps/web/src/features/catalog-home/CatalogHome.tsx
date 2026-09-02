'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

import type { PlaceMapRenderer } from '@/platform/maps/place-map-interface'

import { PlaceFilingControl } from '../personal-library/public/place-filing'
import {
  catalogQuickTypes,
  type CatalogHomePlace,
  type CatalogHomeWorkflow,
  useCatalogHome,
} from './catalog-home-workflow'
import styles from './catalog-home.module.css'

const evidenceLabels = {
  verified: '검증됨', unverified: '검토 전', conflicted: '정보 충돌', stale: '갱신 필요',
} as const

export function CatalogHomeSearch() {
  const workflow = useCatalogHome()
  return (
    <form
      className={styles.search}
      onSubmit={(event) => { event.preventDefault(); workflow.submitSearch() }}
      role="search"
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
        <circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" />
      </svg>
      <input
        aria-label="곳곳간 카탈로그 검색"
        onChange={(event) => workflow.changeDraftQuery(event.target.value)}
        placeholder="장소, 지역, 분류로 곳곳간 카탈로그 검색"
        value={workflow.draftQuery}
      />
      <kbd aria-hidden="true">Enter</kbd>
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

function CollectionChooser({ workflow }: Readonly<{ workflow: CatalogHomeWorkflow }>) {
  if (!workflow.collectionPickerOpen) return null
  if (workflow.collectionState === 'loading') return <p className={styles.pickerState}>컬렉션을 불러오는 중입니다.</p>
  if (workflow.collectionState === 'signed-out') {
    return <p className={styles.pickerState}><a href="/api/auth/oidc/start">로그인</a>하면 내 컬렉션을 선택할 수 있습니다.</p>
  }
  if (workflow.collectionState === 'unavailable') return <p className={styles.pickerState}>컬렉션을 불러오지 못했습니다.</p>
  if (workflow.collections.length === 0) return <p className={styles.pickerState}><a href="/library">내 곳곳간</a>에서 컬렉션을 먼저 만들어 주세요.</p>
  return (
    <div aria-label="정리할 컬렉션 선택" className={styles.collectionPicker}>
      <PlaceFilingControl
        onAccessFailure={workflow.onFilingAccessFailure}
        onApplied={workflow.onFilingApplied}
        placeId={workflow.selected?.placeId}
      />
    </div>
  )
}

function CollectionSummary({ workflow }: Readonly<{ workflow: CatalogHomeWorkflow }>) {
  return (
    <section className={styles.summarySection}>
      <div className={styles.sectionHeading}>
        <h2>내 즐겨찾기 컬렉션</h2><a href="/library">전체 보기</a>
      </div>
      {workflow.collectionState === 'loading' && <p className={styles.empty}>컬렉션을 불러오는 중입니다.</p>}
      {workflow.collectionState === 'signed-out' && <p className={styles.empty}>로그인하면 나만의 컬렉션을 바로 열 수 있어요.</p>}
      {workflow.collectionState === 'unavailable' && <p className={styles.empty}>컬렉션을 지금 불러올 수 없습니다.</p>}
      {workflow.collectionState === 'ready' && workflow.collections.length === 0 && (
        <p className={styles.empty}>아직 컬렉션이 없습니다. 내 곳곳간에서 첫 컬렉션을 만들어 보세요.</p>
      )}
      {workflow.collections.length > 0 && (
        <ul className={styles.collectionList}>
          {workflow.collections.slice(0, 4).map((collection) => (
            <li key={collection.collectionId}>
              <a href={`/library?collection=${collection.collectionId}`}>
                <span aria-hidden="true" className={styles.collectionMark}>◇</span>
                <span>{collection.name}</span><small>{collection.placeCount}곳</small>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RecentActivity({ workflow }: Readonly<{ workflow: CatalogHomeWorkflow }>) {
  return (
    <section className={styles.summarySection}>
      <div className={styles.sectionHeading}><h2>최근 정리</h2></div>
      {workflow.recentlyFiled.length === 0 ? (
        <p className={styles.empty}>이번 접속에서 컬렉션에 정리한 장소가 여기에 표시됩니다.</p>
      ) : (
        <ul className={styles.recentList}>
          {workflow.recentlyFiled.map((item) => (
            <li key={item.placeId}>
              <strong>{item.name}</strong><span>내 카테고리 구성을 업데이트함</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <button aria-pressed={selected} className={selected ? styles.selectedResult : styles.result} onClick={onSelect} type="button">
        <span aria-hidden="true" className={styles.resultIndex}>{index + 1}</span>
        <span className={styles.resultBody}>
          <strong>{place.name}</strong>
          <span>{[place.areaLabel, place.taxonomyLabel].filter(Boolean).join(' · ') || '분류 정보 없음'}</span>
          <small>{evidenceLabels[place.evidenceStatus]}{place.location === null ? ' · 지도 좌표 없음' : ''}</small>
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

function SelectedPlaceCard({ workflow }: Readonly<{ workflow: CatalogHomeWorkflow }>) {
  if (workflow.selected === undefined) return null
  return (
    <section aria-label="선택한 장소" className={styles.selectedCard}>
      <div>
        <span>{workflow.selected.taxonomyLabel ?? '장소'}</span>
        <h2>{workflow.selected.name}</h2>
        <p>{workflow.selected.areaLabel ?? '지역 정보 없음'} · {evidenceLabels[workflow.selected.evidenceStatus]}</p>
      </div>
      <button
        aria-expanded={workflow.collectionPickerOpen}
        className={styles.fileButton}
        onClick={() => workflow.setCollectionPickerOpen(!workflow.collectionPickerOpen)}
        type="button"
      >컬렉션 선택</button>
      <CollectionChooser workflow={workflow} />
    </section>
  )
}

export function CatalogHomeView({ MapRenderer, workflow }: Readonly<{
  MapRenderer: PlaceMapRenderer
  workflow: CatalogHomeWorkflow
}>) {
  const markers = workflow.items.flatMap((place) => place.location === null ? [] : [{
    id: place.placeId, label: place.name, location: place.location,
  }])
  return (
    <div className={styles.home}>
      <section aria-label="검색 조건" className={styles.filterBar}>
        <div className={styles.interpretation}>
          {workflow.interpretation.map((token) => (
            <button key={token.tokenId} onClick={() => workflow.excludeToken(token.tokenId)} type="button">
              {token.label}<span aria-hidden="true">×</span><span className={styles.srOnly}> 조건 제거</span>
            </button>
          ))}
        </div>
        <div aria-label="빠른 장소 유형" className={styles.quickTypes}>
          {catalogQuickTypes.map((type) => (
            <button aria-pressed={workflow.selectedQuickType === type} key={type} onClick={() => workflow.toggleQuickType(type)} type="button">{type}</button>
          ))}
        </div>
      </section>
      <div className={styles.mobileSwitch}>
        <button aria-pressed={workflow.mobileSurface === 'list'} onClick={workflow.showList} type="button">목록</button>
        <button aria-pressed={workflow.mobileSurface === 'map'} onClick={workflow.showMap} type="button">지도</button>
      </div>
      <div className={styles.content}>
        <aside className={workflow.mobileSurface === 'list' ? styles.listPane : `${styles.listPane} ${styles.mobileHidden}`}>
          <CollectionSummary workflow={workflow} />
          <RecentActivity workflow={workflow} />
          <SearchResults workflow={workflow} />
        </aside>
        <section aria-label="카탈로그 지도와 선택한 장소" className={workflow.mobileSurface === 'map' ? styles.mapPane : `${styles.mapPane} ${styles.mobileHidden}`}>
          <button className={styles.viewportButton} disabled={workflow.searchState === 'loading'} onClick={workflow.searchViewport} type="button">이 지역에서 보기</button>
          {markers.length === 0 ? (
            <MapAlternative message={workflow.items.length > 0
              ? '현재 결과에는 표시할 좌표가 없습니다. 목록에서 장소를 선택하고 컬렉션에 정리할 수 있어요.'
              : '검색하면 좌표가 있는 장소가 지도에 표시됩니다.'} />
          ) : (
            <MapBoundary>
              <MapRenderer
                ariaLabel="곳곳간 카탈로그 검색 지도"
                bounds={workflow.viewport.bounds}
                description="곳곳간 내부 통합 장소 카탈로그 결과"
                markers={markers}
                onSelect={workflow.selectPlace}
                onViewportChange={workflow.setViewport}
                selectedMarkerId={workflow.selected?.placeId}
                title="카탈로그 장소"
                zoom={workflow.viewport.zoom}
              />
            </MapBoundary>
          )}
          <SelectedPlaceCard workflow={workflow} />
        </section>
      </div>
    </div>
  )
}

export function CatalogHomeWorkspace({ MapRenderer }: Readonly<{ MapRenderer: PlaceMapRenderer }>) {
  return <CatalogHomeView MapRenderer={MapRenderer} workflow={useCatalogHome()} />
}
