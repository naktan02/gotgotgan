import type {
  LibraryCollectionDetail,
  LibraryCollectionListPage,
  LibraryPlaceListPage,
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
    cursor?: string
    limit: number
  }>): Promise<LibraryPlaceListPage>

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
}
