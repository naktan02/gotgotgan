declare const opaqueVersionBrand: unique symbol

/**
 * A caller may retain and compare this token, but must not parse or construct meaning from it.
 */
export type OpaqueVersion = string & Readonly<{
  [opaqueVersionBrand]: 'library-version'
}>

export type WriteContext = Readonly<{
  operationId: string
  memberId: string
  occurredAt: string
}>

export type Placement =
  | Readonly<{ kind: 'first' }>
  | Readonly<{ kind: 'last' }>
  | Readonly<{ kind: 'before'; placeId: string }>
  | Readonly<{ kind: 'after'; placeId: string }>

export type CollectionVisibility = 'private' | 'unlisted' | 'public'

export type CollectionWorkspaceSummary = Readonly<{
  collectionId: string
  name: string
  description: string | null
  visibility: CollectionVisibility
  placeCount: number
  version: OpaqueVersion
}>

/**
 * Every row is present because it belongs to at least one Collection. Tags and ratings are
 * independent annotations and never make a Place a favorite by themselves.
 */
export type CollectionFavoritePlace = Readonly<{
  placeId: string
  collectionMembershipCount: number
  tagIds: readonly string[]
  personalRating: number | null
}>

export type PersonalLibraryWorkspaceQuery = Readonly<{
  memberId: string
  scope: Readonly<{ kind: 'all' }> | Readonly<{ kind: 'collection'; collectionId: string }>
  collectionCursor?: string | undefined
  placeCursor?: string | undefined
  limit: number
}>

export type PersonalLibraryWorkspaceView = Readonly<{
  schemaVersion: 'personal-library-workspace.v2'
  scope: PersonalLibraryWorkspaceQuery['scope']
  collections: Readonly<{
    items: readonly CollectionWorkspaceSummary[]
    nextCursor?: string | undefined
  }>
  favoritePlaces: Readonly<{
    items: readonly CollectionFavoritePlace[]
    nextCursor?: string | undefined
  }>
}>

export type PlaceFilingQuery = Readonly<{
  memberId: string
  placeId: string
  cursor?: string | undefined
  limit: number
}>

export type PlaceFilingView = Readonly<{
  schemaVersion: 'place-filing.v2'
  placeId: string
  collections: readonly Readonly<{
    collectionId: string
    name: string
    included: boolean
    version: OpaqueVersion
  }>[]
  nextCursor?: string | undefined
}>

export type PlaceFilingChange = Readonly<{
  collectionId: string
  expectedVersion: OpaqueVersion
  desired: 'included' | 'excluded'
  placement?: Placement | undefined
}>

/**
 * Changes are one atomic unit. Collections absent from this array retain their current state,
 * which makes applying a change from a paginated chooser safe.
 */
export type PlaceFilingMutation = Readonly<{
  context: WriteContext
  placeId: string
  changes: readonly PlaceFilingChange[]
}>

export type PlaceFilingReceipt = Readonly<{
  placeId: string
  collections: readonly Readonly<{
    collectionId: string
    included: boolean
    version: OpaqueVersion
  }>[]
}>

export type CollectionOrderMove = Readonly<{
  context: WriteContext
  collectionId: string
  placeId: string
  expectedVersion: OpaqueVersion
  placement: Placement
}>

export type CollectionOrderReceipt = Readonly<{
  collectionId: string
  placeId: string
  version: OpaqueVersion
}>

export type ImportedCollectionMaterialization = Readonly<{
  context: WriteContext
  source: Readonly<{
    providerKey: string
    connectionId: string
    sourceListId: string
    sourcePosition: number
    observedName: string
  }>
  target:
    | Readonly<{
        kind: 'new'
        collectionId: string
        name: string
      }>
    | Readonly<{
        kind: 'existing'
        collectionId: string
        expectedVersion: OpaqueVersion
      }>
  /**
   * The version of this source-list-to-Collection binding, when one was observed during preview.
   * Binding identity is the source list, so multiple source lists may target one Collection.
   */
  expectedBindingVersion?: OpaqueVersion | undefined
  items: readonly Readonly<{
    sourceItemId: string
    providerPlaceId: string
    placeId: string
    sourcePosition: number
  }>[]
}>

export type ImportedCollectionReceipt = Readonly<{
  collectionId: string
  version: OpaqueVersion
  bindingVersion: OpaqueVersion
  membershipCount: number
}>

export type CollectionPublicationChange = Readonly<{
  context: WriteContext
  collectionId: string
  expectedVersion: OpaqueVersion
  visibility: CollectionVisibility
}>

export type CollectionPublicationReceipt = Readonly<{
  collectionId: string
  publicationId: string | null
  visibility: CollectionVisibility
  version: OpaqueVersion
}>

export type PublishedCollectionCopy = Readonly<{
  context: WriteContext
  publicationId: string
  expectedPublicationVersion: OpaqueVersion
  targetCollectionId: string
  targetName: string
  selection:
    | Readonly<{ kind: 'all' }>
    | Readonly<{ kind: 'places'; placeIds: readonly string[] }>
}>

export type PublishedCollectionCopyReceipt = Readonly<{
  collectionId: string
  version: OpaqueVersion
  copiedPlaceCount: number
}>

export type PersonalRating = Readonly<{
  placeId: string
  rating: number | null
  version: OpaqueVersion | null
}>

export type PersonalRatingChange = Readonly<{
  context: WriteContext
  placeId: string
  expectedVersion: OpaqueVersion | null
  rating: number | null
}>

export type PersonalRatingReceipt = Readonly<{
  placeId: string
  rating: number | null
  version: OpaqueVersion | null
}>

export type LibraryWriteRejection =
  | Readonly<{ code: 'not-found' }>
  | Readonly<{ code: 'version-conflict' }>
  | Readonly<{ code: 'operation-id-reused' }>
  | Readonly<{ code: 'invalid-selection' }>
  | Readonly<{ code: 'anchor-not-found' }>
  | Readonly<{ code: 'source-membership-missing' }>
  | Readonly<{ code: 'collection-limit-exceeded'; limit: number }>
  | Readonly<{ code: 'binding-version-conflict' }>
  | Readonly<{ code: 'publication-changed' }>

/**
 * Reusing an operationId with the same normalized request returns `replayed` with the original
 * value. Reusing it with a different request returns the stable `operation-id-reused` rejection.
 */
export type LibraryWriteResult<Value> =
  | Readonly<{
      status: 'applied' | 'replayed'
      operationId: string
      value: Value
    }>
  | Readonly<{
      status: 'rejected'
      operationId: string
      rejection: LibraryWriteRejection
    }>

export class InvalidCollectionFirstInputError extends Error {
  override readonly name = 'InvalidCollectionFirstInputError'

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
  }
}
