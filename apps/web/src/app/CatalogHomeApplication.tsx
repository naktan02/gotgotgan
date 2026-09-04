'use client'

import {
  CatalogHomeProvider,
  CatalogHomeSearch,
  CatalogHomeWorkspace,
  type CatalogHomeLibrary,
} from '@/features/catalog-home/public'
import {
  CollectionLibraryProblem,
  collectionLibraryHttp,
} from '@/features/personal-library/public'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { MapLibrePlaceMap } from '@/platform/maps/public'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

const homeLibrary: CatalogHomeLibrary = {
  async readCollections(signal) {
    try {
      const page = await collectionLibraryHttp.workspace({
        favoriteScope: { kind: 'all' },
        ratingFilter: { kind: 'any' },
        tagIds: [],
        tagMatch: 'all',
        areaKeys: [],
        taxonomyKeys: [],
        limit: 20,
      }, signal)
      return {
        kind: 'ready',
        items: page.collections.map((item) => ({
          collectionId: item.collectionId,
          name: item.name,
          placeCount: item.placeCount,
        })),
      }
    } catch (error) {
      return error instanceof CollectionLibraryProblem && error.status === 401
        ? { kind: 'signed-out' }
        : { kind: 'unavailable' }
    }
  },
}

export function CatalogHomeApplication({
  familyNavigation,
  initialQuery,
}: Readonly<{ familyNavigation: FamilyNavigation; initialQuery?: string }>) {
  return (
    <CatalogHomeProvider initialQuery={initialQuery} library={homeLibrary}>
      <PlaceWorkspaceShell familyNavigation={familyNavigation} topbarSearch={<CatalogHomeSearch />}>
        <CatalogHomeWorkspace MapRenderer={MapLibrePlaceMap} />
      </PlaceWorkspaceShell>
    </CatalogHomeProvider>
  )
}
