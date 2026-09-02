'use client'

import {
  PublicCollectionDiscovery,
  publicCollectionDiscoveryGateway,
} from '@/features/public-discovery/public'
import { DeterministicPlaceMap } from '@/platform/maps/DeterministicPlaceMap'

export function BrowseWorkspace() {
  return <PublicCollectionDiscovery
    gateway={publicCollectionDiscoveryGateway}
    mapRenderer={DeterministicPlaceMap}
  />
}
