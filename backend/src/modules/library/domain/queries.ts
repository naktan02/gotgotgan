export type LibraryPlaceState = 'saved' | 'wanted' | 'rated'
export type LibraryTagMatch = 'all' | 'any'

export type LibraryPlaceSummary = Readonly<{
  placeId: string
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }>
  primaryTaxonomy: Readonly<{ key: string; label: string }> | null
  taxonomyKeys: readonly string[]
  evidence: Readonly<{
    status: 'verified' | 'unverified' | 'conflicted' | 'stale'
    projectedAt: string
  }>
}>

export type PublishedCollection = Readonly<{
  publicationId: string
  visibility: 'unlisted' | 'public'
  name: string
  description: string | null
  placeCount: number
  places: readonly Readonly<{
    placeId: string
    position: number
    place: LibraryPlaceSummary | null
  }>[]
  nextCursor?: string
  updatedAt: string
}>

export type LibraryMapBounds = Readonly<{
  west: number
  south: number
  east: number
  north: number
}>

export type LibraryMapScope =
  | Readonly<{
      kind: 'state'
      state: LibraryPlaceState
      tagIds: readonly string[]
      tagMatch: LibraryTagMatch
      areaKeys: readonly string[]
      taxonomyKeys: readonly string[]
    }>
  | Readonly<{
      kind: 'collection'
      collectionId: string
    }>

export type LibraryMapFeature =
  | Readonly<{
      kind: 'place'
      placeId: string
      label: string
      location: Readonly<{ latitude: number; longitude: number }>
    }>
  | Readonly<{
      kind: 'cluster'
      clusterId: string
      count: number
      location: Readonly<{ latitude: number; longitude: number }>
      bounds: LibraryMapBounds
    }>

export type LibraryMapProjection = Readonly<{
  schemaVersion: 'library-map-projection.v1'
  scope: LibraryMapScope
  viewport: Readonly<{
    bounds: LibraryMapBounds
    zoom: number
  }>
  features: readonly LibraryMapFeature[]
  coverage: Readonly<{
    representedPlaceCount: number
    unprojectedPlaceCount: number
    complete: boolean
  }>
}>

export type PublishedCollectionMap = Readonly<{
  schemaVersion: 'place-published-collection-map.v1'
  publicationId: string
  viewport: Readonly<{
    bounds: LibraryMapBounds
    zoom: number
  }>
  features: readonly LibraryMapFeature[]
  coverage: Readonly<{
    representedPlaceCount: number
    unprojectedPlaceCount: number
    complete: boolean
  }>
}>

export type PublicCollectionDirectoryPage = Readonly<{
  items: readonly Readonly<{
    publicationId: string
    name: string
    description: string | null
    placeCount: number
    updatedAt: string
  }>[]
  nextCursor?: string
}>

export type LibraryPlaceListPage = Readonly<{
  schemaVersion: 'library-place-list.v3'
  filter: Readonly<{
    state: LibraryPlaceState
    tagIds: readonly string[]
    tagMatch: LibraryTagMatch
    areaKeys: readonly string[]
    taxonomyKeys: readonly string[]
  }>
  items: readonly Readonly<{
    placeId: string
    saved: boolean
    wanted: boolean
    personalRating: number | null
    updatedAt: string
    place: LibraryPlaceSummary | null
  }>[]
  nextCursor?: string
}>

export type LibraryPlaceFacet = Readonly<{
  key: string
  label: string
  count: number
}>

export type LibraryPlaceFacetsPage = Readonly<{
  schemaVersion: 'library-place-facets.v1'
  sourceState: 'saved'
  coverage: Readonly<{
    savedPlaceCount: number
    sampledPlaceCount: number
    projectedPlaceCount: number
    complete: boolean
  }>
  areas: readonly LibraryPlaceFacet[]
  taxonomies: readonly LibraryPlaceFacet[]
}>

export type LibraryCollectionSummary = Readonly<{
  collectionId: string
  name: string
  description: string | null
  visibility: 'private' | 'unlisted' | 'public'
  publicationId: string | null
  placeCount: number
  updatedAt: string
}>

export type LibraryCollectionListPage = Readonly<{
  schemaVersion: 'library-collection-list.v1'
  items: readonly LibraryCollectionSummary[]
  nextCursor?: string
}>

export type LibraryCollectionDetail = Readonly<{
  schemaVersion: 'library-collection-detail.v1'
  collection: LibraryCollectionSummary
  places: readonly Readonly<{
    placeId: string
    position: number
    addedAt: string
    place: LibraryPlaceSummary | null
  }>[]
  nextCursor?: string
}>

export type LibraryTagListPage = Readonly<{
  schemaVersion: 'library-tag-list.v1'
  items: readonly Readonly<{
    tagId: string
    name: string
    placeCount: number
    createdAt: string
  }>[]
  nextCursor?: string
}>

export type LibraryPlaceOrganizationPage = Readonly<{
  schemaVersion: 'library-place-organization.v1'
  placeId: string
  items: readonly (
    | Readonly<{
        kind: 'collection'
        collectionId: string
        name: string
        selected: boolean
        position: number | null
      }>
    | Readonly<{
        kind: 'tag'
        tagId: string
        name: string
        selected: boolean
      }>
  )[]
  nextCursor?: string
}>

export class InvalidLibraryCursorError extends Error {
  override readonly name = 'InvalidLibraryCursorError'
}

export class InvalidLibraryQueryError extends Error {
  override readonly name = 'InvalidLibraryQueryError'
}
