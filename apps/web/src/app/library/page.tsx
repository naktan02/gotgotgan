import { PersonalLibrary } from '@/features/personal-library/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function LibraryPage() {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return (
    <PlaceWorkspaceShell
      currentPage="library"
      familyNavigation={familyNavigation}
      stageLabel="개인 라이브러리"
    >
      <PersonalLibrary />
    </PlaceWorkspaceShell>
  )
}
