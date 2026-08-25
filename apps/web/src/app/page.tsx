import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'
import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'

export const dynamic = 'force-dynamic'

export default function HomePage() {
  const familyNavigation = readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)
  return <PlaceWorkspaceShell familyNavigation={familyNavigation} />
}
