import type {
  LibraryCollectionDetail,
  LibraryCollectionListPage,
  LibraryPlaceFacetsPage,
  LibraryPlaceListPage,
  LibraryPlaceOrganizationPage,
  LibraryPlaceState,
  LibraryTagMatch,
  LibraryTagListPage,
} from '../domain/queries.js'

export interface LibraryQueries {
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
