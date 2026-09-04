'use client'

import type { PublishedCollection } from '@place/contracts/http'

import { PublishedCollectionExperience } from '@/features/publications/public'
import { MapLibrePlaceMap } from '@/platform/maps/public'

export function PublishedCollectionWorkspace({
  collection,
}: Readonly<{ collection: PublishedCollection }>) {
  return (
    <PublishedCollectionExperience
      initialCollection={collection}
      mapRenderer={MapLibrePlaceMap}
    />
  )
}
