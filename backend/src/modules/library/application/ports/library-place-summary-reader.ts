import type { LibraryPlaceSummary } from '../../domain/queries.js'

export type LibraryPlaceSummaryReader = (
  placeIds: readonly string[],
) => Promise<readonly LibraryPlaceSummary[]>

/** Private fallback for a member's applied imports; never a publication source. */
export type MemberLibraryPlaceSummaryReader = (
  memberId: string,
  placeIds: readonly string[],
) => Promise<readonly LibraryPlaceSummary[]>
