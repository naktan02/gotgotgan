'use client'

import {
  PublicCollectionDiscovery,
  publicCollectionDiscoveryGateway,
} from '@/features/public-discovery/public'
import { MapLibrePlaceMap } from '@/platform/maps/public'

export function BrowseWorkspace() {
  return <PublicCollectionDiscovery
    gateway={publicCollectionDiscoveryGateway}
    mapRenderer={MapLibrePlaceMap}
  />
}
