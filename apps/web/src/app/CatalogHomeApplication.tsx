'use client'

import {
  CatalogHomeProvider,
  CatalogHomeSearch,
  CatalogHomeWorkspace,
  type CatalogHomeLibrary,
} from '@/features/catalog-home/public'
import {
  BrowserLibraryProblem,
  personalLibraryHttp,
} from '@/features/personal-library/public'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'
import { PlaceWorkspaceShell } from '@/shells/place-workspace/PlaceWorkspaceShell'

const homeLibrary: CatalogHomeLibrary = {
  async readCollections(signal) {
    try {
      const page = await personalLibraryHttp.collections(undefined, signal)
      return {
        kind: 'ready',
        items: page.items.map((item) => ({
          collectionId: item.collectionId,
          name: item.name,
          placeCount: item.placeCount,
        })),
      }
    } catch (error) {
      return error instanceof BrowserLibraryProblem && error.status === 401
        ? { kind: 'signed-out' }
        : { kind: 'unavailable' }
    }
  },
  async filePlace(input) {
    try {
      await personalLibraryHttp.command({
        commandId: crypto.randomUUID(),
        command: {
          kind: 'add-collection-place',
          collectionId: input.collectionId,
          placeId: input.placeId,
        },
      })
      return { kind: 'success' }
    } catch {
      return { kind: 'unavailable' }
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
        <CatalogHomeWorkspace MapRenderer={DeterministicPlaceMap} />
      </PlaceWorkspaceShell>
    </CatalogHomeProvider>
  )
}
