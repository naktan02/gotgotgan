import type {
  LibraryCollectionDetail,
  LibraryCollectionListPage,
  LibraryMapBounds,
  LibraryMapProjection,
  LibraryMapScope,
  LibraryPlaceFacetsPage,
  LibraryPlaceListPage,
  LibraryPlaceOrganizationPage,
  LibraryPlaceState,
  LibraryTagMatch,
  LibraryTagListPage,
  PublishedCollection,
  PublishedCollectionMap,
} from '../domain/queries.js'

export interface LibraryQueries {
  getPublishedCollection(input: Readonly<{
    publicationId: string
    cursor?: string
    limit: number
  }>): Promise<PublishedCollection | undefined>

  getPublishedCollectionMap(input: Readonly<{
    publicationId: string
    bounds: LibraryMapBounds
    zoom: number
  }>): Promise<PublishedCollectionMap | undefined>

  getMapProjection(input: Readonly<{
    memberId: string
    scope: LibraryMapScope
    bounds: LibraryMapBounds
    zoom: number
  }>): Promise<LibraryMapProjection | undefined>

  listPlaces(input: Readonly<{
    memberId: string
    state: LibraryPlaceState
    tagIds: readonly string[]
    tagMatch: LibraryTagMatch
    areaKeys: readonly string[]
    taxonomyKeys: readonly string[]
    cursor?: string
    limit: number
  }>): Promise<LibraryPlaceListPage>

  getPlaceFacets(input: Readonly<{
    memberId: string
  }>): Promise<LibraryPlaceFacetsPage>

  listCollections(input: Readonly<{
    memberId: string
    cursor?: string
    limit: number
  }>): Promise<LibraryCollectionListPage>

  getCollection(input: Readonly<{
    memberId: string
    collectionId: string
    cursor?: string
    limit: number
  }>): Promise<LibraryCollectionDetail | undefined>

  listTags(input: Readonly<{
    memberId: string
    cursor?: string
    limit: number
  }>): Promise<LibraryTagListPage>

  getPlaceOrganization(input: Readonly<{
    memberId: string
    placeId: string
    cursor?: string
    limit: number
  }>): Promise<LibraryPlaceOrganizationPage>
}
