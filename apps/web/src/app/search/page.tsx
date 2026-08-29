import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { PlaceSearchWorkspace } from './PlaceSearchWorkspace'

export const dynamic = 'force-dynamic'

export default function SearchPage() {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return (
    <PlaceWorkspaceShell currentPage="search" familyNavigation={familyNavigation}>
      <PlaceSearchWorkspace />
    </PlaceWorkspaceShell>
  )
}
