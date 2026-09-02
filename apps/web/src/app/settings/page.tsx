import { SettingsDestination } from '@/features/navigation-destinations/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function SettingsPage() {
  return (
    <PlaceWorkspaceShell
      currentPage="settings"
      familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    >
      <SettingsDestination />
    </PlaceWorkspaceShell>
  )
}
