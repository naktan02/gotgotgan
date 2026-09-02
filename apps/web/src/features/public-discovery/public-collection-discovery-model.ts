export type DiscoveryFacet = Readonly<{ key: string; label: string; count?: number }>

export type DiscoveryPlaceSummary = Readonly<{
  placeId: string
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  taxonomyLabel: string | null
}>

export type DiscoveryPlace = Readonly<{
  placeId: string
  position: number
  place: DiscoveryPlaceSummary | null
}>

export type DiscoveryCollection = Readonly<{
  publicationId: string
  publicationVersion: string
  name: string
  description: string | null
  placeCount: number
  updatedAt: string
  owner: Readonly<{ handle: string; displayName: string }>
  topics: readonly DiscoveryFacet[]
  previewPlaces: readonly DiscoveryPlace[]
}>

export type DiscoveryFilters = Readonly<{
  query: string
  areaKey: string
  taxonomyKey: string
  topicKey: string
  sort: 'recent' | 'largest' | 'name'
}>

export type DiscoveryDirectoryPage = Readonly<{
  items: readonly DiscoveryCollection[]
  nextCursor?: string
  availableFilters: Readonly<{
    areas: readonly DiscoveryFacet[]
    taxonomies: readonly DiscoveryFacet[]
    topics: readonly DiscoveryFacet[]
  }>
}>

export type DiscoveryCollectionDetail = DiscoveryCollection & Readonly<{
  places: readonly DiscoveryPlace[]
  nextCursor?: string
}>

export type DiscoveryCopyAttempt = Readonly<{
  targetCollectionId: string
  execute: (signal?: AbortSignal) => Promise<void>
}>

export type DiscoveryGateway = Readonly<{
  directory: (input: DiscoveryFilters & Readonly<{ cursor?: string }>, signal?: AbortSignal) => Promise<DiscoveryDirectoryPage>
  detail: (publicationId: string, cursor?: string, signal?: AbortSignal) => Promise<DiscoveryCollectionDetail>
  createCopyAttempt: (input: Readonly<{
    collection: DiscoveryCollection
    selection: Readonly<{ kind: 'all' }> | Readonly<{ kind: 'places'; placeIds: readonly string[] }>
  }>) => DiscoveryCopyAttempt
  report: (handle: string, reason: DiscoveryReportReason, signal?: AbortSignal) => Promise<void>
}>

export type DiscoveryReportReason =
  | 'impersonation'
  | 'harassment'
  | 'privacy'
  | 'spam'
  | 'unsafe-content'

export class DiscoveryHttpProblem extends Error {
  override readonly name = 'DiscoveryHttpProblem'

  constructor(readonly status: number, readonly code?: string) {
    super(`Public Collection discovery request failed with ${status}`)
  }
}
