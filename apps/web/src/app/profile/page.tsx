import {
  PublicProfileModerationInbox,
  PublicProfileSettings,
} from '@/features/public-profiles/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function ProfilePage() {
  return <PlaceWorkspaceShell
    currentPage="profile"
    familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    stageLabel="공개 프로필"
  >
    <PublicProfileSettings />
    <PublicProfileModerationInbox />
  </PlaceWorkspaceShell>
}
