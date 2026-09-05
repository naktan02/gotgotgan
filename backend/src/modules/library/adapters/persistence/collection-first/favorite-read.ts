import type { Pool } from 'pg'

import { matchesLibraryPlaceFacets } from '../../../application/library-place-facets.js'
import type {
  LibraryPlaceSummaryReader, MemberLibraryPlaceSummaryReader,
} from '../../../application/ports/library-place-summary-reader.js'
import type { PersonalLibraryWorkspaceQuery } from '../../../domain/collection-first.js'
import type { LibraryPlaceSummary } from '../../../domain/queries.js'

export type FavoriteRow = Readonly<{
  canonical_place_id: string
  collection_count: number
  tag_ids: string[]
  tag_names: string[]
  personal_rating: string | null
}>

export async function summariesById(
  read: LibraryPlaceSummaryReader, placeIds: readonly string[], memberId: string,
  readMember?: MemberLibraryPlaceSummaryReader,
): Promise<ReadonlyMap<string, LibraryPlaceSummary>> {
  const requested = new Set(placeIds)
  const summaries = new Map((await read(placeIds))
    .filter((summary) => requested.has(summary.placeId))
    .map((summary) => [summary.placeId, summary]))
  const missing = placeIds.filter((placeId) => !summaries.has(placeId))
  if (readMember !== undefined && missing.length > 0) {
    const allowed = new Set(missing)
    for (const summary of await readMember(memberId, missing)) {
      if (allowed.has(summary.placeId)) summaries.set(summary.placeId, summary)
    }
  }
  return summaries
}

export function matchesFavorite(
  row: FavoriteRow, summary: LibraryPlaceSummary | undefined,
  query: Pick<PersonalLibraryWorkspaceQuery, 'areaKeys' | 'taxonomyKeys' | 'placeQuery'>,
): boolean {
  if (!matchesLibraryPlaceFacets(summary, query)) return false
  const terms = query.placeQuery?.split(' ').filter(Boolean) ?? []
  if (terms.length === 0) return true
  const text = [summary?.name, summary?.areaLabel, summary?.primaryTaxonomy?.label,
    ...(row.tag_names ?? [])].filter(Boolean).join(' ').normalize('NFKC').toLowerCase()
  return terms.every((term) => text.includes(term))
}

/** One bounded owner-only candidate page; public facts are joined through summary ports, never SQL. */
export async function readFavoriteRows(
  pool: Pool, query: PersonalLibraryWorkspaceQuery, afterPlaceId: string | undefined, limit: number,
): Promise<FavoriteRow[]> {
  const selectedCollectionId = query.favoriteScope.kind === 'collection'
    ? query.favoriteScope.collectionId : null
  const result = await pool.query<FavoriteRow>(
    `WITH candidates AS (
       SELECT DISTINCT placed.canonical_place_id
       FROM library.collection_places AS placed
       JOIN library.collections AS collection ON collection.id = placed.collection_id
       WHERE collection.owner_membership_id = $1::uuid
         AND ($2::uuid IS NULL OR collection.id = $2::uuid)
         AND ($3::uuid IS NULL OR placed.canonical_place_id > $3::uuid)
     )
     SELECT candidate.canonical_place_id,
            (SELECT count(*)::int FROM library.collection_places AS all_placed
             JOIN library.collections AS all_collection ON all_collection.id = all_placed.collection_id
             WHERE all_collection.owner_membership_id = $1::uuid
               AND all_placed.canonical_place_id = candidate.canonical_place_id) AS collection_count,
            coalesce(array_agg(DISTINCT tagged.tag_id)
              FILTER (WHERE tagged.tag_id IS NOT NULL), ARRAY[]::uuid[])::text[] AS tag_ids,
            coalesce(array_agg(DISTINCT tag.name)
              FILTER (WHERE tag.name IS NOT NULL), ARRAY[]::text[]) AS tag_names,
            preference.personal_rating
     FROM candidates AS candidate
     LEFT JOIN library.place_preferences AS preference
       ON preference.membership_id = $1::uuid AND preference.canonical_place_id = candidate.canonical_place_id
     LEFT JOIN library.place_tags AS tagged
       ON tagged.membership_id = $1::uuid AND tagged.canonical_place_id = candidate.canonical_place_id
     LEFT JOIN library.tags AS tag ON tag.id = tagged.tag_id AND tag.owner_membership_id = $1::uuid
     WHERE ($4::text = 'any'
         OR ($4::text = 'rated' AND preference.personal_rating IS NOT NULL)
         OR ($4::text = 'unrated' AND preference.personal_rating IS NULL))
     GROUP BY candidate.canonical_place_id, preference.personal_rating
     HAVING cardinality($5::uuid[]) = 0
        OR ($6::text = 'any' AND count(DISTINCT tagged.tag_id)
            FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) > 0)
        OR ($6::text = 'all' AND count(DISTINCT tagged.tag_id)
            FILTER (WHERE tagged.tag_id = ANY($5::uuid[])) = cardinality($5::uuid[]))
     ORDER BY candidate.canonical_place_id ASC LIMIT $7`,
    [query.memberId, selectedCollectionId, afterPlaceId ?? null,
      query.ratingFilter.kind, query.tagIds, query.tagMatch, limit],
  )
  return result.rows
}
