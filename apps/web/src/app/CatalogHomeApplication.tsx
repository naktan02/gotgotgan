'use client'

import {
  CatalogHomeProvider,
  CatalogHomeSearch,
  CatalogHomeWorkspace,
  type CatalogHomeLibrary,
} from '@/features/catalog-home/public'
import {
  PlaceFilingControl,
  favoriteCollectionDirectory,
} from '@/features/personal-library/public'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { MapLibrePlaceMap } from '@/platform/maps/public'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

const homeLibrary: CatalogHomeLibrary = favoriteCollectionDirectory

export function CatalogHomeApplication({
  familyNavigation,
  initialQuery,
}: Readonly<{ familyNavigation: FamilyNavigation; initialQuery?: string }>) {
  return (
    <CatalogHomeProvider initialQuery={initialQuery} library={homeLibrary}>
      <PlaceWorkspaceShell familyNavigation={familyNavigation} topbarSearch={<CatalogHomeSearch />}>
        <CatalogHomeWorkspace
          MapRenderer={MapLibrePlaceMap}
          PlaceFilingRenderer={PlaceFilingControl}
        />
      </PlaceWorkspaceShell>
    </CatalogHomeProvider>
  )
}
