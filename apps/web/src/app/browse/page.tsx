import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { BrowseWorkspace } from './BrowseWorkspace'

export const dynamic = 'force-dynamic'

export default function BrowsePage() {
  return (
    <PlaceWorkspaceShell
      currentPage="explore"
      familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    >
      <BrowseWorkspace />
    </PlaceWorkspaceShell>
  )
}
