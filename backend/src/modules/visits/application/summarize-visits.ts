import type { VisitStore } from './ports/visit-store.js'

export function summarizeVisits(memberId: string, placeId: string, store: VisitStore) {
  return store.summarize(memberId, placeId)
}
