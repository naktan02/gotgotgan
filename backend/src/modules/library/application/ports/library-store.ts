import type {
  LibraryAttempt,
  LibraryCommandOutcome,
  MemberLibrary,
  PlacePreferences,
  PublishedCollection,
} from '../../domain/model.js'

export interface LibraryStore {
  apply(attempt: LibraryAttempt): Promise<LibraryCommandOutcome>
  getPublishedCollection(publicationId: string): Promise<PublishedCollection | undefined>
  getMemberLibrary(memberId: string): Promise<MemberLibrary>
  getPlacePreferences?(memberId: string, placeId: string): Promise<PlacePreferences | undefined>
}
