'use client'

import type { PublishedCollection } from '@place/contracts/http'

import { PublishedCollectionExperience } from '@/features/publications/public'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

export function PublishedCollectionWorkspace({
  collection,
}: Readonly<{ collection: PublishedCollection }>) {
  return (
    <PublishedCollectionExperience
      initialCollection={collection}
      mapRenderer={DeterministicPlaceMap}
    />
  )
}
