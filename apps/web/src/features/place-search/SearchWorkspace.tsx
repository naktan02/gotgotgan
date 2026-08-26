'use client'

import { SearchWorkspaceView } from './SearchWorkspaceView'
import { usePlaceSearchWorkflow } from './search-workspace-workflow'

export function SearchWorkspace() {
  return <SearchWorkspaceView workflow={usePlaceSearchWorkflow()} />
}
