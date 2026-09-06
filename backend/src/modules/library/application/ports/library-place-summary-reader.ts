import type { LibraryPlaceSummary } from '../../domain/queries.js'

export type LibraryPlaceSummaryReader = (
  placeIds: readonly string[],
) => Promise<readonly LibraryPlaceSummary[]>

/** Private applied-import evidence; search text is internal and never a facet or publication source. */
export type MemberLibraryPlaceSummaryReader = (
  memberId: string,
  placeIds: readonly string[],
) => Promise<readonly Readonly<{
  summary: LibraryPlaceSummary
  sourceObservedSearchText: string
}>[]>
