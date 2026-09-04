'use client'

import { SearchWorkspaceView } from './SearchWorkspaceView'
import type { PlaceMapRenderer } from '@/platform/maps/public'
import type { SearchCanonicalPlaceDetailRenderer } from './search-workspace-interface'
import { usePlaceSearchWorkflow } from './search-workspace-workflow'

export function SearchWorkspace({
  mapRenderer,
  renderCanonicalPlaceDetail,
}: Readonly<{
  mapRenderer: PlaceMapRenderer
  renderCanonicalPlaceDetail?: SearchCanonicalPlaceDetailRenderer
}>) {
  return (
    <SearchWorkspaceView
      mapRenderer={mapRenderer}
      renderCanonicalPlaceDetail={renderCanonicalPlaceDetail}
      workflow={usePlaceSearchWorkflow()}
    />
  )
}
