import type {
  LocalPlaceSearchDocument,
  MemberSearchSignal,
} from '../../domain/model.js'

export interface LocalSearchProjectionStore {
  upsertPlace(document: LocalPlaceSearchDocument): Promise<void>
  upsertMemberSignal(signal: MemberSearchSignal): Promise<void>
}
