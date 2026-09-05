import type {
  CollectionOrderMove,
  CollectionOrderReceipt,
  CollectionLifecycleCommand,
  CollectionLifecycleReceipt,
  CollectionPublicationChange,
  CollectionPublicationReceipt,
  ImportedCollectionMaterialization,
  ImportedCollectionReceipt,
  LibraryWriteResult,
  PersonalLibraryWorkspaceQuery,
  PersonalLibraryWorkspaceView,
  PersonalLibraryMapQuery,
  PersonalLibraryMapView,
  PersonalRating,
  PersonalRatingChange,
  PersonalRatingReceipt,
  PlaceFilingMutation,
  PlaceFilingQuery,
  PlaceFilingReceipt,
  PlaceFilingView,
  PublishedCollectionCopy,
  PublishedCollectionCopyReceipt,
} from '../../domain/collection-first.js'

/** Read model for the member's Collection-centered library surface. */
export interface PersonalLibraryWorkspace {
  open(query: PersonalLibraryWorkspaceQuery): Promise<PersonalLibraryWorkspaceView | undefined>
  openMap(query: PersonalLibraryMapQuery, signal?: AbortSignal): Promise<PersonalLibraryMapView | undefined>
}

/** Atomic filing of one Place into or out of one or more explicitly named Collections. */
export interface PlaceFiling {
  open(query: PlaceFilingQuery): Promise<PlaceFilingView | undefined>
  apply(mutation: PlaceFilingMutation): Promise<LibraryWriteResult<PlaceFilingReceipt>>
}

/** Reorders one existing Collection membership without exposing numeric persistence positions. */
export interface CollectionOrder {
  move(input: CollectionOrderMove): Promise<LibraryWriteResult<CollectionOrderReceipt>>
}

/** Creates, edits, publishes, or deletes a member-owned Collection with one revision model. */
export interface CollectionLifecycle {
  apply(input: CollectionLifecycleCommand): Promise<LibraryWriteResult<CollectionLifecycleReceipt>>
}

/** Provider-neutral materialization of one observed source list into one private Collection. */
export interface ImportedCollectionMaterializer {
  materialize(
    input: ImportedCollectionMaterialization,
  ): Promise<LibraryWriteResult<ImportedCollectionReceipt>>
}

/** Publication lifecycle and explicit whole/partial copy across member Libraries. */
export interface PublishedCollectionExchange {
  setPublication(
    input: CollectionPublicationChange,
  ): Promise<LibraryWriteResult<CollectionPublicationReceipt>>
  copy(
    input: PublishedCollectionCopy,
  ): Promise<LibraryWriteResult<PublishedCollectionCopyReceipt>>
}

/** Rating history/current state independent from Collection membership and Tag attachment. */
export interface PersonalRatingLedger {
  get(memberId: string, placeId: string): Promise<PersonalRating>
  set(input: PersonalRatingChange): Promise<LibraryWriteResult<PersonalRatingReceipt>>
}
