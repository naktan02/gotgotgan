import type { Pool } from 'pg'

import { createLibraryMapAccumulator } from '../../../application/library-map-features.js'
import { libraryFacetFilterScanLimit } from '../../../application/library-place-facets.js'
import { normalizePersonalLibraryWorkspaceQuery } from '../../../application/validate-collection-first.js'
import type {
  LibraryPlaceSummaryReader, MemberLibraryPlaceSummaryReader,
} from '../../../application/ports/library-place-summary-reader.js'
import type { PersonalLibraryMapQuery, PersonalLibraryMapView } from '../../../domain/collection-first.js'
import { InvalidLibraryQueryError, isValidLibraryMapViewport } from '../../../domain/queries.js'
import { matchesFavorite, readFavoriteRows, summariesById } from './favorite-read.js'

export async function readWorkspaceMap(
  pool: Pool, read: LibraryPlaceSummaryReader, readMember: MemberLibraryPlaceSummaryReader | undefined,
  input: PersonalLibraryMapQuery, signal?: AbortSignal,
): Promise<PersonalLibraryMapView | undefined> {
  signal?.throwIfAborted()
  if (!isValidLibraryMapViewport(input.bounds, input.zoom)) {
    throw new InvalidLibraryQueryError('Library map viewport is invalid.')
  }
  const query = normalizePersonalLibraryWorkspaceQuery({ ...input, limit: 50 })
  if (query.favoriteScope.kind === 'collection') {
    const owned = await pool.query(
      'SELECT 1 FROM library.collections WHERE id = $1::uuid AND owner_membership_id = $2::uuid',
      [query.favoriteScope.collectionId, query.memberId],
    )
    if (owned.rows[0] === undefined) return undefined
  }
  const accumulator = createLibraryMapAccumulator(input)
  let afterPlaceId: string | undefined
  let unprojectedPlaceCount = 0
  while (true) {
    signal?.throwIfAborted()
    const rows = await readFavoriteRows(pool, query, afterPlaceId, libraryFacetFilterScanLimit)
    signal?.throwIfAborted()
    const summaries = await summariesById(read, rows.map((row) => row.canonical_place_id), query.memberId, readMember)
    signal?.throwIfAborted()
    for (const row of rows) {
      const summary = summaries.get(row.canonical_place_id)
      if (summary === undefined) {
        // A missing projection cannot establish either a text/facet match or a non-match.
        unprojectedPlaceCount += 1
      } else if (matchesFavorite(row, summary, query)) {
        if (summary.location === null) unprojectedPlaceCount += 1
        else accumulator.add(summary)
      }
    }
    if (rows.length < libraryFacetFilterScanLimit) break
    afterPlaceId = rows.at(-1)?.canonical_place_id
  }
  const features = accumulator.finish()
  return {
    schemaVersion: 'personal-library-map.v2',
    filter: {
      favoriteScope: query.favoriteScope, ratingFilter: query.ratingFilter,
      tagIds: query.tagIds, tagMatch: query.tagMatch, areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys,
      ...(query.placeQuery === undefined ? {} : { placeQuery: query.placeQuery }),
    },
    viewport: { bounds: input.bounds, zoom: input.zoom }, features,
    coverage: {
      representedPlaceCount: features.reduce((count, feature) => count + (feature.kind === 'place' ? 1 : feature.count), 0),
      unprojectedPlaceCount, complete: unprojectedPlaceCount === 0,
    },
  }
}
