import type { LocalSearchProjectionStore } from './ports/local-search-projection-store.js'
import {
  assertLocalPlaceSearchDocument,
  assertMemberSearchSignal,
  type LocalPlaceSearchDocument,
  type MemberSearchSignal,
} from '../domain/model.js'

export async function projectLocalPlace(
  document: LocalPlaceSearchDocument,
  store: LocalSearchProjectionStore,
): Promise<void> {
  assertLocalPlaceSearchDocument(document)
  await store.upsertPlace(document)
}

export async function projectMemberSearchSignal(
  signal: MemberSearchSignal,
  store: LocalSearchProjectionStore,
): Promise<void> {
  assertMemberSearchSignal(signal)
  await store.upsertMemberSignal(signal)
}
