import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { PlaceLibraryWorkspace } from './PlaceLibraryWorkspace'

export const dynamic = 'force-dynamic'

export default function LibraryPage() {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return (
    <PlaceWorkspaceShell
      currentPage="library"
      familyNavigation={familyNavigation}
    >
      <PlaceLibraryWorkspace />
    </PlaceWorkspaceShell>
  )
}
