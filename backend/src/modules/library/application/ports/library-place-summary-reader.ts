import type { LibraryPlaceSummary } from '../../domain/queries.js'

export type LibraryPlaceSummaryReader = (
  placeIds: readonly string[],
) => Promise<readonly LibraryPlaceSummary[]>
