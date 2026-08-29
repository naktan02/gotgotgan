'use client'

import { PersonalLibraryDetailPane } from './PersonalLibraryDetailPane'
import { PersonalLibraryListPane } from './PersonalLibraryListPane'
import { PersonalLibraryMap } from './PersonalLibraryMap'
import styles from './personal-library-browse.module.css'
import type { PersonalLibraryWorkflow } from './personal-library-workflow'
import type { PlaceMapRenderer } from '@/platform/maps/place-map-interface'

export function PersonalLibraryBrowseView({
  mapRenderer,
  workflow,
}: Readonly<{ workflow: PersonalLibraryWorkflow; mapRenderer: PlaceMapRenderer }>) {
  const { error, mobileSurface, selectedPlaceId } = workflow
  const mobileClass = mobileSurface === 'map'
    ? styles.mobileMap
    : mobileSurface === 'detail'
      ? styles.mobileDetail
      : styles.mobileList
  const workspaceClass = selectedPlaceId === undefined
    ? `${styles.workspace} ${styles.withoutDetail} ${mobileClass}`
    : `${styles.workspace} ${styles.withDetail} ${mobileClass}`

  return (
    <>
      <div className={styles.mobileSwitcher} aria-label="내 장소 화면">
        <button
          aria-pressed={mobileSurface === 'list'}
          onClick={() => workflow.showMobileSurface('list')}
          type="button"
        >목록</button>
        <button
          aria-pressed={mobileSurface === 'map'}
          onClick={() => workflow.showMobileSurface('map')}
          type="button"
        >지도</button>
      </div>

      {error !== undefined && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button onClick={() => void workflow.retry()} type="button">다시 시도</button>
        </div>
      )}

      <div className={workspaceClass}>
        <PersonalLibraryListPane workflow={workflow} />
        <PersonalLibraryDetailPane workflow={workflow} />
        <div className={styles.mapPane}>
          <PersonalLibraryMap
            error={workflow.mapError}
            loading={workflow.mapLoading}
            onSelect={workflow.selectPlace}
            onRetry={workflow.retryMap}
            onViewportChange={workflow.changeMapViewport}
            projection={workflow.mapProjection}
            selectedPlaceId={selectedPlaceId}
            viewport={workflow.mapViewport}
            mapRenderer={mapRenderer}
          />
        </div>
      </div>
    </>
  )
}
