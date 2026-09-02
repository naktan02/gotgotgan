import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { SettingsWorkspace } from './SettingsWorkspace'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ searchParams }: Readonly<{
  searchParams: Promise<Readonly<{ tab?: string | string[] }>>
}>) {
  const rawTab = (await searchParams).tab
  return (
    <PlaceWorkspaceShell
      currentPage="settings"
      familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    >
      <SettingsWorkspace initialTab={Array.isArray(rawTab) ? rawTab[0] : rawTab} />
    </PlaceWorkspaceShell>
  )
}
