import { BrowseDestination } from '@/features/navigation-destinations/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function BrowsePage() {
  return (
    <PlaceWorkspaceShell
      currentPage="explore"
      familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    >
      <BrowseDestination />
    </PlaceWorkspaceShell>
  )
}
