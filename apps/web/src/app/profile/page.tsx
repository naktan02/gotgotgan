import {
  PublicProfileModerationInbox,
  PublicProfileSettings,
} from '@/features/public-profiles/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import styles from './profile.module.css'

export const dynamic = 'force-dynamic'

export default function ProfilePage() {
  return <PlaceWorkspaceShell
    currentPage="settings"
    familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
  >
    <div aria-label="프로필 설정 및 알림" className={styles.page} role="region">
      <PublicProfileSettings />
      <PublicProfileModerationInbox />
    </div>
  </PlaceWorkspaceShell>
}
