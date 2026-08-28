import type {
  LibraryAttempt,
  LibraryCommandOutcome,
  PlacePreferences,
  PublishedCollection,
} from '../../domain/model.js'

export interface LibraryStore {
  apply(attempt: LibraryAttempt): Promise<LibraryCommandOutcome>
  getPublishedCollection(publicationId: string): Promise<PublishedCollection | undefined>
  getPlacePreferences(memberId: string, placeId: string): Promise<PlacePreferences | undefined>
}
