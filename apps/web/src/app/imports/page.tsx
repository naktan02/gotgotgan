import { ConnectedPlaceImports } from '@/features/place-imports/public'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

export const dynamic = 'force-dynamic'

export default function ImportsPage() {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return (
    <PlaceWorkspaceShell
      currentPage="imports"
      familyNavigation={familyNavigation}
      stageLabel="저장목록 가져오기"
    >
      <ConnectedPlaceImports />
    </PlaceWorkspaceShell>
  )
}
