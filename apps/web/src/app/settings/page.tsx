import { readFamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

import { SettingsWorkspace } from './SettingsWorkspace'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ searchParams }: Readonly<{
  searchParams: Promise<Readonly<{ tab?: string | string[] }>>
}>) {
  const rawTab = (await searchParams).tab
  const sharedImportRuntimeEnabled = process.env.NODE_ENV !== 'production' ||
    process.env.PLACE_IMPORT_ACQUISITION_RUNTIME_ENABLED === 'true'
  const remoteImportPreviewEnabled = process.env.NODE_ENV !== 'production'
  return (
    <PlaceWorkspaceShell
      currentPage="settings"
      familyNavigation={readFamilyNavigation(process.env.PLACE_FAMILY_NAVIGATION_MANIFEST)}
    >
      <SettingsWorkspace
        remoteImportPreviewEnabled={remoteImportPreviewEnabled}
        sharedImportRuntimeEnabled={sharedImportRuntimeEnabled}
        initialTab={Array.isArray(rawTab) ? rawTab[0] : rawTab}
      />
    </PlaceWorkspaceShell>
  )
}
