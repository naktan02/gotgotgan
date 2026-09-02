import {
  PublicProfileModerationInbox,
  PublicProfileSettings,
} from '@/features/public-profiles/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function ProfilePage() {
  return <PlaceWorkspaceShell
    currentPage="settings"
    familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
  >
    <PublicProfileSettings />
    <PublicProfileModerationInbox />
  </PlaceWorkspaceShell>
}
