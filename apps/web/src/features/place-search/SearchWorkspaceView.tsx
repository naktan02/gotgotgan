'use client'

import type { PlaceMapRenderer } from '@/platform/maps/public'

import { SearchControls } from './SearchControls'
import { SearchResultDetailPane } from './SearchResultDetailPane'
import { SearchResultListPane } from './SearchResultListPane'
import styles from './search-workspace.module.css'
import type {
  SearchCanonicalPlaceDetailRenderer,
  SearchWorkspaceWorkflow,
} from './search-workspace-interface'

export function SearchWorkspaceView({
  workflow,
  mapRenderer: MapRenderer,
  renderCanonicalPlaceDetail,
}: Readonly<{
  workflow: SearchWorkspaceWorkflow
  mapRenderer: PlaceMapRenderer
  renderCanonicalPlaceDetail?: SearchCanonicalPlaceDetailRenderer
}>) {
  const { layout, map } = workflow
  const { mobileSurface } = layout
  const mobileClass = mobileSurface === 'map'
    ? styles.mobileMap
    : mobileSurface === 'detail'
      ? styles.mobileDetail
      : styles.mobileList
  const workspaceClass = !layout.hasSelection
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
          <button aria-pressed={mobileSurface === 'list'} onClick={layout.showList} type="button">목록</button>
          <button aria-pressed={mobileSurface === 'map'} onClick={layout.showMap} type="button">지도</button>
        </div>
      </header>

      <SearchControls controls={workflow.controls} />

      <div className={workspaceClass}>
        <div className={styles.resultsPane}>
          <SearchResultListPane results={workflow.results} />
        </div>
        <div className={styles.detailPane}>
          <SearchResultDetailPane
            detail={workflow.detail}
            renderCanonicalPlaceDetail={renderCanonicalPlaceDetail}
          />
        </div>
        <div className={styles.mapPane}>
          <MapRenderer
            ariaLabel="검색 결과 지도"
            bounds={map.bounds}
            markers={map.markers}
            onMove={map.panViewport}
            onSelect={map.selectMarker}
            selectedMarkerId={map.selectedMarkerId}
          />
        </div>
      </div>
    </section>
  )
}
