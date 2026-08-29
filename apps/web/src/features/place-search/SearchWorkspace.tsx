'use client'

import { SearchWorkspaceView } from './SearchWorkspaceView'
import type { SearchCanonicalPlaceDetailRenderer } from './search-workspace-interface'
import { usePlaceSearchWorkflow } from './search-workspace-workflow'

export function SearchWorkspace({
  renderCanonicalPlaceDetail,
}: Readonly<{
  renderCanonicalPlaceDetail?: SearchCanonicalPlaceDetailRenderer
}>) {
  return (
    <SearchWorkspaceView
      renderCanonicalPlaceDetail={renderCanonicalPlaceDetail}
      workflow={usePlaceSearchWorkflow()}
    />
  )
}
