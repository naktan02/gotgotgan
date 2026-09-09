'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { PlaceMapRenderer } from '@/platform/maps/public'

import { PersonalLibraryMap } from '../library-map/PersonalLibraryMap'
import { collectionColorValue } from '../library-map/collection-color-palette'
import { PersonalPlaceDetail } from '../personal-place-detail/PersonalPlaceDetail'
import type { PersonalPlaceNavigation } from '../draft-navigation/DraftNavigation'
import { PlaceFilingEditor } from '../place-filing/PlaceFilingEditor'
import { CollectionDirectory, CollectionPlaces } from './CollectionPanels'
import { CollectionFilters } from './CollectionFilters'
import styles from './collection-workspace.module.css'
import { useCollectionLibraryWorkflow, type CollectionLibraryWorkflow, type LibraryInitialScope } from './collection-library-workflow'

type ScopeNavigation = ReactNode | ((query: string) => ReactNode)

function statusMessage(status: CollectionLibraryWorkflow['pageStatus']) {
  if (status === 'forbidden') return '현재 계정에는 내 곳곳간을 볼 권한이 없습니다.'
  if (status === 'not-found') return '선택한 카테고리가 삭제되었거나 더 이상 존재하지 않습니다.'
  if (status === 'unavailable') return '내 곳곳간 서비스에 연결할 수 없습니다.'
  return '내 곳곳간을 불러오지 못했습니다.'
}

export function CollectionLibraryView({ mapRenderer: MapRenderer, workflow, scopeNavigation }: Readonly<{
  mapRenderer: PlaceMapRenderer; workflow: CollectionLibraryWorkflow; scopeNavigation?: ScopeNavigation
}>) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dragHeight, setDragHeight] = useState<number>()
  const drag = useRef<{ y: number; height: number; available: number; moved: boolean } | undefined>(undefined)
  const suppressSheetClick = useRef(false)
  const detailNavigation = useRef<PersonalPlaceNavigation>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mapCollectionsOpen, setMapCollectionsOpen] = useState(false)
  const [mapCollectionQuery, setMapCollectionQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState(workflow.placeQuery)
  const directoryFocus = useRef<HTMLButtonElement | null>(null)
  const placeFocus = useRef<HTMLButtonElement | null>(null)
  const lastPanelFocus = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const isDirectory = workflow.mobileSurface === 'collections'
  const isDetail = workflow.selectedPlaceId !== undefined && !isDirectory
  const selected = workflow.selectedPlace?.place
  const scope = isDirectory ? '내 목록' : workflow.selectedCollection?.name ?? '전체 저장 장소'
  const visibleMapCollections = workflow.collections.filter((collection) => collection.name
    .normalize('NFKC').toLocaleLowerCase().includes(mapCollectionQuery.trim().normalize('NFKC').toLocaleLowerCase()))
  const selectedMapCollections = workflow.mapSelection.kind === 'all'
    ? workflow.mapCollectionMetadata
    : workflow.mapSelection.kind === 'none'
      ? []
      : workflow.mapSelection.collectionIds.flatMap((collectionId) => {
          const collection = workflow.mapCollectionMetadata.find((item) => item.collectionId === collectionId)
          return collection === undefined ? [] : [collection]
        })

  useEffect(() => { setDraftQuery(workflow.placeQuery) }, [workflow.placeQuery])

  useEffect(() => {
    if (workflow.mobileSurface === 'detail') {
      setCollapsed(false); setFiltersOpen(false)
      requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-label="선택한 장소 상세"]')?.focus())
    }
  }, [workflow.mobileSurface, workflow.selectedPlaceId])

  const restoreFocus = (target: HTMLElement | null) => {
    requestAnimationFrame(() => target?.focus({ preventScroll: true }))
  }
  const navigate = (action: () => void) => detailNavigation.current ? detailNavigation.current.requestNavigation(action) : action()
  const backToPlaces = () => navigate(() => { workflow.closeDetail(); restoreFocus(placeFocus.current) })
  const backToDirectory = () => {
    workflow.showCollections(); setFiltersOpen(false); restoreFocus(directoryFocus.current)
  }
  const togglePanel = () => {
    if (collapsed) restoreFocus(lastPanelFocus.current)
    setCollapsed(!collapsed)
  }

  if (workflow.pageStatus === 'authentication-required') {
    return <section className={styles.gate}>
      <p>내 곳곳간</p><h1>내 목록을 보려면 로그인이 필요합니다.</h1>
      <span>카테고리와 개인 기록은 로그인한 본인에게만 표시됩니다.</span>
      <a href="/api/auth/oidc/start">로그인하고 계속</a>
    </section>
  }
  if (workflow.pageStatus !== 'loading' && workflow.pageStatus !== 'ready') {
    return <section className={styles.gate} role="alert">
      <p>내 곳곳간</p><h1>{statusMessage(workflow.pageStatus)}</h1>
      <span>{workflow.pageStatus === 'unavailable'
        ? '로그인 여부와 별개로 서비스 연결이 준비되지 않았거나 일시적으로 중단되었습니다.'
        : '개인 목록은 현재 계정의 접근 권한으로만 확인할 수 있습니다.'}</span>
      {workflow.pageStatus !== 'forbidden' && <button type="button" onClick={workflow.pageStatus === 'not-found'
        ? workflow.recoverMissingCollection : workflow.retry}>
        {workflow.pageStatus === 'not-found' ? '내 목록으로 돌아가기' : '다시 시도'}
      </button>}
    </section>
  }

  return <section aria-label="내 곳곳간 작업 공간" className={`${styles.library} ${collapsed ? styles.collapsed : ''}`}
    style={{ '--sheet-height': `${dragHeight ?? (expanded ? 82 : 54)}%` } as CSSProperties}>
    <div className={styles.workspace}>
      <div className={styles.workPanel} hidden={collapsed} id="library-work-panel" ref={panel}
        onFocusCapture={(event) => {
          lastPanelFocus.current = event.target as HTMLElement
          if (isDetail && (event.target instanceof HTMLTextAreaElement ||
            (event.target instanceof HTMLInputElement && ['text', 'search'].includes(event.target.type)))) setExpanded(true)
        }}>
        {scopeNavigation && <div className={styles.scopeNavigation}>{typeof scopeNavigation === 'function' ? scopeNavigation(draftQuery) : scopeNavigation}</div>}
        <div className={styles.mobileSheetControls}>
          <button className={styles.mobileHandle} type="button" aria-label={`작업 패널 높이: ${expanded ? '크게' : '중간'}. 누르거나 방향키로 조절`}
            onClick={() => { if (!suppressSheetClick.current) setExpanded(!expanded); suppressSheetClick.current = false }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'Home') { event.preventDefault(); setExpanded(true) }
              if (event.key === 'ArrowDown' || event.key === 'End') { event.preventDefault(); if (expanded) setExpanded(false); else setCollapsed(true) }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { y: event.clientY, height: expanded ? 82 : 54, available: panel.current?.parentElement?.clientHeight ?? innerHeight, moved: false }
            }}
            onPointerMove={(event) => {
              if (!drag.current) return
              const delta = drag.current.y - event.clientY
              if (Math.abs(delta) > 5) drag.current.moved = true
              if (drag.current.moved) setDragHeight(Math.max(8, Math.min(88, drag.current.height + delta / drag.current.available * 100)))
            }}
            onPointerUp={(event) => {
              const gesture = drag.current
              if (!gesture) return
              const height = gesture.height + (gesture.y - event.clientY) / gesture.available * 100
              if (gesture.moved) { setCollapsed(height < 28); setExpanded(height >= 68) }
              suppressSheetClick.current = gesture.moved
              drag.current = undefined
              setDragHeight(undefined)
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => { drag.current = undefined; setDragHeight(undefined) }}>
            <span aria-hidden="true" /><small>{expanded ? '패널 줄이기' : '패널 키우기'}</small>
          </button>
          <button type="button" onClick={() => setCollapsed(true)}>지도만</button>
        </div>
        <div className={styles.surface} hidden={!isDirectory || filtersOpen}>
          <CollectionDirectory workflow={workflow} onAllPlaces={(button) => {
            directoryFocus.current = button; workflow.selectAllPlaces()
            requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('#library-collection-heading')?.focus())
          }} onSelect={(id, button) => {
            directoryFocus.current = button; workflow.selectCollection(id)
            requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('#library-collection-heading')?.focus())
          }} />
        </div>
        <div className={styles.surface} hidden={isDirectory || isDetail || filtersOpen}>
          <CollectionPlaces workflow={workflow} query={draftQuery} onQueryChange={setDraftQuery} onBack={backToDirectory} onFilters={() => setFiltersOpen(true)}
            onSelect={(id, button) => { placeFocus.current = button; workflow.selectPlace(id) }} />
        </div>
        {filtersOpen && <div className={styles.surface}>
          <CollectionFilters workflow={workflow} onClose={() => {
            setFiltersOpen(false)
            requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('#library-filter-toggle')?.focus())
          }} />
        </div>}
        {isDetail && <aside className={styles.detailSurface} aria-label="선택한 장소 상세" data-detail-scroll tabIndex={-1}>
          <button className={styles.backButton} onClick={backToPlaces} type="button">← 장소 목록으로</button>
          <PersonalPlaceDetail key={workflow.selectedPlaceId} filingEditor={<PlaceFilingEditor workflow={workflow.filing} />}
            navigationRef={detailNavigation}
            filingDraft={{ label: '목록 선택', dirty: workflow.filing.dirtyCount > 0, saving: workflow.filing.saving, valid: true,
              save: workflow.filing.save, discard: workflow.filing.discard }}
            onChanged={workflow.refresh} placeId={workflow.selectedPlaceId!}
            summary={selected == null ? undefined : {
              name: selected.name, areaLabel: selected.areaLabel, location: selected.location,
              primaryTaxonomy: selected.primaryTaxonomy, evidenceStatus: selected.evidence.status,
            }} />
        </aside>}
      </div>
      <button aria-controls="library-work-panel" aria-expanded={!collapsed}
        aria-label={collapsed ? '작업 패널 펼치기' : '작업 패널 접고 지도 보기'}
        className={styles.collapseButton} onClick={togglePanel} type="button">
        <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        <span className={styles.collapseLabel}>{collapsed ? scope : '지도 넓게'}</span>
      </button>
      <div className={styles.mapPane}>
        {workflow.collections.length > 0 && <div className={styles.mapCollectionControl}>
          <button aria-expanded={mapCollectionsOpen} className={styles.mapCollectionTrigger}
            onClick={() => setMapCollectionsOpen(!mapCollectionsOpen)} type="button">
            <span aria-hidden="true">★</span> 즐겨찾기 표시
            {workflow.mapSelection.kind !== 'none' && <small>{workflow.mapSelection.kind === 'all'
              ? '전체' : workflow.mapSelection.collectionIds.length}</small>}
          </button>
          {mapCollectionsOpen && <section aria-label="지도 즐겨찾기 표시 설정" className={styles.mapCollections}>
            <header><strong>지도에 겹쳐 보기</strong><button onClick={workflow.clearMapCollections} type="button">전체 해제</button></header>
            <input aria-label="표시할 즐겨찾기 목록 검색" maxLength={160}
              onChange={(event) => setMapCollectionQuery(event.target.value)} placeholder="Collection 검색"
              type="search" value={mapCollectionQuery} />
            <button aria-pressed={workflow.mapSelection.kind === 'all'} type="button"
              onClick={workflow.selectAllMapCollections}>전체 저장 장소</button>
            <div>{visibleMapCollections.map((collection) => {
              const projected = workflow.mapCollectionMetadata.find((item) => item.collectionId === collection.collectionId)
              const checked = workflow.mapSelection.kind === 'all' || (
                workflow.mapSelection.kind === 'collections' && workflow.mapSelection.collectionIds.includes(collection.collectionId)
              )
              return <label key={collection.collectionId}>
                <input checked={checked} onChange={() => workflow.toggleMapCollection(collection.collectionId)} type="checkbox" />
                <span aria-hidden="true" style={projected === undefined ? undefined : {
                  background: collectionColorValue(projected.colorToken),
                }} />
                {collection.name}
              </label>
            })}</div>
            <small>지도에는 한 번에 최대 100개 Collection을 표시합니다.</small>
            {selectedMapCollections.length > 0 && <div aria-label="선택한 Collection 범례" className={styles.mapCollectionLegend}>
              {selectedMapCollections.map((collection) => <span key={collection.collectionId}>
                <i aria-hidden="true" style={{ background: collectionColorValue(collection.colorToken) }} />{collection.name}
              </span>)}
            </div>}
          </section>}
        </div>}
        <PersonalLibraryMap
          error={workflow.mapStatus === 'error' ? '지도를 불러올 수 없습니다. 목록 기능은 계속 사용할 수 있습니다.' : undefined}
          loading={workflow.mapStatus === 'loading'} mapRenderer={MapRenderer} onRetry={workflow.retryMap}
          onSelect={(id) => navigate(() => { workflow.selectPlace(id); setCollapsed(false) })}
          onOpenPlaceList={() => navigate(() => {
            workflow.closeDetail(); setFiltersOpen(false); setCollapsed(false)
            requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('#library-collection-heading')?.focus())
          })}
          onViewportChange={workflow.setMapViewport} projection={workflow.mapProjection}
          selectedPlaceId={workflow.selectedPlaceId} viewport={workflow.mapViewport}
        />
        {isDirectory && <p className={styles.mapHint}>전체 저장 장소를 지도에서 보고, 목록을 선택해 좁혀 볼 수 있습니다.</p>}
      </div>
    </div>
  </section>
}

export function CollectionLibrary({ mapRenderer, scopeNavigation, ...initial }: Readonly<{ mapRenderer: PlaceMapRenderer; scopeNavigation?: ScopeNavigation }> & LibraryInitialScope) {
  return <CollectionLibraryView mapRenderer={mapRenderer} workflow={useCollectionLibraryWorkflow(initial)} scopeNavigation={scopeNavigation} />
}
