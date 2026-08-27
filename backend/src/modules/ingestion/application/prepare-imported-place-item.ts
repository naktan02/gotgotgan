import type { ConnectedPlaceItem } from './ports/connected-place-source.js'
import type { PreparedImportItem } from './ports/import-worker-store.js'

export function prepareImportedPlaceItem(
  item: ConnectedPlaceItem,
  nextId: () => string,
): PreparedImportItem {
  const prepared = {
    ...item,
    itemId: nextId(),
    observationId: nextId(),
    candidateId: nextId(),
    decisionId: nextId(),
    proposedPlaceId: nextId(),
  }
  if (item.providerPlaceId === undefined) return prepared
  return {
    ...prepared,
    fulfillment: {
      jobId: nextId(),
      observationId: nextId(),
      candidateId: nextId(),
      decisionId: nextId(),
      proposedPlaceId: nextId(),
    },
    detail: {
      jobId: nextId(),
      observationId: nextId(),
      candidateId: nextId(),
    },
  }
}
