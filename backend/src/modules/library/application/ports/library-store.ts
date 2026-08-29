import type {
  LibraryAttempt,
  LibraryCommandOutcome,
  PlacePreferences,
} from '../../domain/model.js'

export interface LibraryStore {
  apply(attempt: LibraryAttempt): Promise<LibraryCommandOutcome>
  getPlacePreferences(memberId: string, placeId: string): Promise<PlacePreferences | undefined>
}
