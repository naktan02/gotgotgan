'use client'

import { CollectionLibrary } from '@/features/personal-library/public'
import { MapLibrePlaceMap } from '@/platform/maps/public'

export function PlaceLibraryWorkspace() {
  return <CollectionLibrary mapRenderer={MapLibrePlaceMap} />
}
