import type { OpaqueVersion } from './collection-first.js'
import type { LibraryPlaceSummary } from './queries.js'

export type PublicCollectionTopic = Readonly<{ key: string; label: string }>
export type PublicCollectionDiscoverySort = 'recent' | 'largest' | 'name'

export type PublicCollectionDiscoveryQuery = Readonly<{
  q: string | null
  areaKeys: readonly string[]
  taxonomyKeys: readonly string[]
  topicKeys: readonly string[]
  sort: PublicCollectionDiscoverySort
  cursor?: string | undefined
  limit: number
}>

export type PublicCollectionOwner = Readonly<{ handle: string; displayName: string }>
export type PublicCollectionPlace = Readonly<{
  placeId: string
  position: number
  place: LibraryPlaceSummary | null
}>

export type PublicCollectionDiscoverySummary = Readonly<{
  publicationId: string
  publicationVersion: OpaqueVersion
  name: string
  description: string | null
  placeCount: number
  updatedAt: string
  owner: PublicCollectionOwner
  topics: readonly PublicCollectionTopic[]
  previewPlaces: readonly PublicCollectionPlace[]
}>

export type PublicCollectionDiscoveryPage = Readonly<{
  filter: Omit<PublicCollectionDiscoveryQuery, 'cursor' | 'limit'>
  items: readonly PublicCollectionDiscoverySummary[]
  nextCursor?: string | undefined
  availableFilters: Readonly<{
    areas: readonly Readonly<{ key: string; label: string; count: number }>[]
    taxonomies: readonly Readonly<{ key: string; label: string; count: number }>[]
    topics: readonly Readonly<{ key: string; label: string; count: number }>[]
  }>
}>

export type DiscoverableCollectionQuery = Readonly<{
  publicationId: string
  cursor?: string | undefined
  limit: number
}>

export type DiscoverableCollection = Readonly<{
  publicationId: string
  publicationVersion: OpaqueVersion
  name: string
  description: string | null
  placeCount: number
  updatedAt: string
  owner: PublicCollectionOwner
  topics: readonly PublicCollectionTopic[]
  places: readonly PublicCollectionPlace[]
  nextCursor?: string | undefined
}>
