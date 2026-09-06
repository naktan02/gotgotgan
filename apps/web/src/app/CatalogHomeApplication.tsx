'use client'

import {
  CatalogHomeProvider,
  CatalogHomeWorkspace,
  type CatalogHomeLibrary,
  type CatalogHomePlaceDetailRenderer,
} from '@/features/catalog-home/public'
import {
  PersonalPlaceDetail,
  favoriteCollectionDirectory,
} from '@/features/personal-library/public'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { MapLibrePlaceMap } from '@/platform/maps/public'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

const homeLibrary: CatalogHomeLibrary = favoriteCollectionDirectory
const HomePlaceDetail: CatalogHomePlaceDetailRenderer = ({ place, navigationRef, onChanged }) => (
  <PersonalPlaceDetail placeId={place.placeId} navigationRef={navigationRef} onChanged={onChanged} summary={{
    name: place.name, areaLabel: place.areaLabel, location: place.location,
    primaryTaxonomy: place.taxonomyLabel ? { label: place.taxonomyLabel } : null,
  }} />
)

export function CatalogHomeApplication({
  familyNavigation,
  initialQuery,
}: Readonly<{ familyNavigation: FamilyNavigation; initialQuery?: string }>) {
  return (
    <CatalogHomeProvider initialQuery={initialQuery} library={homeLibrary}>
      <PlaceWorkspaceShell familyNavigation={familyNavigation}>
        <CatalogHomeWorkspace
          MapRenderer={MapLibrePlaceMap}
          PlaceDetailRenderer={HomePlaceDetail}
        />
      </PlaceWorkspaceShell>
    </CatalogHomeProvider>
  )
}
