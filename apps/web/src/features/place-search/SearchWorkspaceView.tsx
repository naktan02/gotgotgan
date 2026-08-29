'use client'

import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

import { SearchControls } from './SearchControls'
import { SearchResultDetailPane } from './SearchResultDetailPane'
import { SearchResultListPane } from './SearchResultListPane'
import styles from './search-workspace.module.css'
import type { SearchWorkspaceWorkflow } from './search-workspace-workflow'

export function SearchWorkspaceView({
  workflow,
}: Readonly<{ workflow: SearchWorkspaceWorkflow }>) {
  const {
    viewportBounds,
    items,
    selectedResultId,
    selected,
    mobileSurface,
    showMobileSurface,
    selectResult,
    panViewport,
  } = workflow
  const mobileClass = mobileSurface === 'map'
    ? styles.mobileMap
    : mobileSurface === 'detail'
      ? styles.mobileDetail
      : styles.mobileList
  const workspaceClass = selected === undefined
    ? `${styles.content} ${styles.withoutDetail} ${mobileClass}`
    : `${styles.content} ${styles.withDetail} ${mobileClass}`

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

      <SearchControls workflow={workflow} />

      <div className={workspaceClass}>
        <SearchResultListPane workflow={workflow} />
        <SearchResultDetailPane workflow={workflow} />
        <div className={styles.mapPane}>
          <DeterministicPlaceMap
            ariaLabel="검색 결과 지도"
            bounds={viewportBounds}
            markers={items.map((item) => ({
              id: item.resultId,
              label: item.name,
              location: item.location,
            }))}
            onMove={panViewport}
            onSelect={selectResult}
            selectedMarkerId={selectedResultId}
          />
        </div>
      </div>
    </section>
  )
}
