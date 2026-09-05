'use client'

import { useEffect, useRef, useState } from 'react'

import type { PlaceMapRenderer } from '@/platform/maps/public'

import { PersonalLibraryMap } from '../library-map/PersonalLibraryMap'
import { PersonalPlaceDetail } from '../personal-place-detail/PersonalPlaceDetail'
import { PlaceFilingEditor } from '../place-filing/PlaceFilingEditor'
import { CollectionDirectory, CollectionPlaces } from './CollectionPanels'
import { CollectionFilters } from './CollectionFilters'
import styles from './collection-workspace.module.css'
import { useCollectionLibraryWorkflow, type CollectionLibraryWorkflow } from './collection-library-workflow'

function statusMessage(status: CollectionLibraryWorkflow['pageStatus']) {
  if (status === 'forbidden') return '현재 계정에는 내 곳곳간을 볼 권한이 없습니다.'
  if (status === 'not-found') return '선택한 카테고리가 삭제되었거나 더 이상 존재하지 않습니다.'
  if (status === 'unavailable') return '내 곳곳간 서비스에 연결할 수 없습니다.'
  return '내 곳곳간을 불러오지 못했습니다.'
}

export function CollectionLibraryView({ mapRenderer: MapRenderer, workflow }: Readonly<{
  mapRenderer: PlaceMapRenderer; workflow: CollectionLibraryWorkflow
}>) {
  const [collapsed, setCollapsed] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const directoryFocus = useRef<HTMLButtonElement | null>(null)
  const placeFocus = useRef<HTMLButtonElement | null>(null)
  const lastPanelFocus = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const isDirectory = workflow.mobileSurface === 'collections'
  const isDetail = workflow.selectedPlaceId !== undefined && !isDirectory
  const selected = workflow.selectedPlace?.place
  const scope = isDirectory ? '내 목록' : workflow.selectedCollection?.name ?? '전체 저장 장소'

  useEffect(() => {
    if (workflow.mobileSurface === 'detail') {
      setCollapsed(false); setFiltersOpen(false)
      requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[aria-label="선택한 장소 상세"]')?.focus())
    }
  }, [workflow.mobileSurface, workflow.selectedPlaceId])

  const restoreFocus = (target: HTMLElement | null) => {
    requestAnimationFrame(() => target?.focus({ preventScroll: true }))
  }
  const backToPlaces = () => { workflow.closeDetail(); restoreFocus(placeFocus.current) }
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

  return <section aria-label="내 곳곳간 작업 공간" className={`${styles.library} ${collapsed ? styles.collapsed : ''}`}>
    <div className={styles.workspace}>
      <div className={styles.workPanel} hidden={collapsed} id="library-work-panel" ref={panel}
        onFocusCapture={(event) => { lastPanelFocus.current = event.target as HTMLElement }}>
        <div className={styles.mobileHandle} aria-hidden="true" />
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
          <CollectionPlaces workflow={workflow} onBack={backToDirectory} onFilters={() => setFiltersOpen(true)}
            onSelect={(id, button) => { placeFocus.current = button; workflow.selectPlace(id) }} />
        </div>
        {filtersOpen && <div className={styles.surface}>
          <CollectionFilters workflow={workflow} onClose={() => {
            setFiltersOpen(false)
            requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('#library-filter-toggle')?.focus())
          }} />
        </div>}
        {isDetail && <aside className={styles.detailSurface} aria-label="선택한 장소 상세" tabIndex={-1}>
          <button className={styles.backButton} onClick={backToPlaces} type="button">← 장소 목록으로</button>
          <PersonalPlaceDetail filingEditor={<PlaceFilingEditor workflow={workflow.filing} />}
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
        <PersonalLibraryMap
          error={workflow.mapStatus === 'error' ? '지도를 불러올 수 없습니다. 목록 기능은 계속 사용할 수 있습니다.' : undefined}
          loading={workflow.mapStatus === 'loading'} mapRenderer={MapRenderer} onRetry={workflow.retryMap}
          onSelect={(id) => { workflow.selectPlace(id); setCollapsed(false) }}
          onViewportChange={workflow.setMapViewport} projection={workflow.mapProjection}
          selectedPlaceId={workflow.selectedPlaceId} viewport={workflow.mapViewport}
        />
        {isDirectory && <p className={styles.mapHint}>목록을 선택하면 담아 둔 장소가 지도에 표시됩니다.</p>}
      </div>
    </div>
  </section>
}

export function CollectionLibrary({ mapRenderer }: Readonly<{ mapRenderer: PlaceMapRenderer }>) {
  return <CollectionLibraryView mapRenderer={mapRenderer} workflow={useCollectionLibraryWorkflow()} />
}
