'use client'

import { CollectionLibrary } from '@/features/personal-library/public'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

export function PlaceLibraryWorkspace() {
  return <CollectionLibrary mapRenderer={DeterministicPlaceMap} />
}
