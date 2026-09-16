import type { Pool } from 'pg'

import {
  buildLibraryPlaceFacets,
  libraryFacetFilterScanLimit,
  libraryFacetSampleLimit,
  matchesLibraryPlaceFacets,
} from '../../../application/library-place-facets.js'
import { decodePlaceCursor, encodePlaceCursor } from '../../../application/library-cursor.js'
import type { LibraryQueries } from '../../../application/library-queries.js'
import type { LibraryPlaceSummaryReader } from '../../../application/ports/library-place-summary-reader.js'
import { InvalidLibraryQueryError, type LibraryPlaceSummary } from '../../../domain/queries.js'

type PreferenceRow = Readonly<{
  canonical_place_id: string; saved: boolean; wanted: boolean
  personal_rating: string | null; updated_at: Date
}>
type SavedPlaceRow = Readonly<{ canonical_place_id: string; saved_place_count: number }>

function normalizedKeys(values: readonly string[], field: 'areaKeys' | 'taxonomyKeys') {
  const normalized = [...values].sort()
  const valid = field === 'areaKeys'
    ? normalized.every((key) => /^area_[A-Za-z0-9_-]{22}$/.test(key))
    : normalized.every((key) => key.length > 0 && key.length <= 128)
  if (normalized.length > 10 || new Set(normalized).size !== normalized.length || !valid) {
    throw new InvalidLibraryQueryError(`Library ${field} filter is invalid.`)
  }
  return normalized
}

async function summariesById(read: LibraryPlaceSummaryReader, placeIds: readonly string[]) {
  if (placeIds.length === 0) return new Map<string, LibraryPlaceSummary>()
  const requested = new Set(placeIds)
  return new Map((await read(placeIds))
    .filter((summary) => requested.has(summary.placeId))
    .map((summary) => [summary.placeId, summary]))
}

export async function listPostgresLibraryPlaces(
  pool: Pool,
  readPlaceSummaries: LibraryPlaceSummaryReader,
  input: Parameters<LibraryQueries['listPlaces']>[0],
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
  }
  if (!['saved', 'wanted', 'rated'].includes(input.state)) {
    throw new InvalidLibraryQueryError('Library Place state is invalid.')
  }
  if (input.tagMatch !== 'all' && input.tagMatch !== 'any') {
    throw new InvalidLibraryQueryError('Library tag match mode is invalid.')
  }
  const tagIds = [...input.tagIds].sort()
  if (tagIds.length > 20 || new Set(tagIds).size !== tagIds.length ||
    tagIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new InvalidLibraryQueryError('Library tag filter is invalid.')
  }
  const areaKeys = normalizedKeys(input.areaKeys, 'areaKeys')
  const taxonomyKeys = normalizedKeys(input.taxonomyKeys, 'taxonomyKeys')
  const filter = { state: input.state, tagIds, tagMatch: input.tagMatch, areaKeys, taxonomyKeys }
  const cursor = decodePlaceCursor(input.cursor, filter)
  const preferenceFilter = input.state === 'saved' ? 'saved'
    : input.state === 'wanted' ? 'wanted' : 'personal_rating IS NOT NULL'
  const facetFiltered = areaKeys.length > 0 || taxonomyKeys.length > 0
  const scanLimit = facetFiltered ? libraryFacetFilterScanLimit : input.limit
  const result = await pool.query<PreferenceRow>(
    `SELECT canonical_place_id, saved, wanted, personal_rating, updated_at
     FROM library.place_preferences
     WHERE membership_id = $1::uuid AND ${preferenceFilter}
       AND (cardinality($4::uuid[]) = 0
         OR ($5::text = 'any' AND EXISTS (
           SELECT 1 FROM library.place_tags AS tagged
           WHERE tagged.membership_id = $1::uuid
             AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
             AND tagged.tag_id = ANY($4::uuid[])))
         OR ($5::text = 'all' AND (
           SELECT count(*) FROM library.place_tags AS tagged
           WHERE tagged.membership_id = $1::uuid
             AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
             AND tagged.tag_id = ANY($4::uuid[])) = cardinality($4::uuid[])))
       AND ($2::timestamptz IS NULL OR updated_at < $2::timestamptz
         OR (updated_at = $2::timestamptz AND canonical_place_id > $3::uuid))
     ORDER BY updated_at DESC, canonical_place_id ASC LIMIT $6`,
    [input.memberId, cursor?.updatedAt ?? null, cursor?.placeId ?? null,
      tagIds, input.tagMatch, scanLimit + 1],
  )
  const scannedRows = result.rows.slice(0, scanLimit)
  const summaries = await summariesById(
    readPlaceSummaries, scannedRows.map((row) => row.canonical_place_id),
  )
  const matchingRows = scannedRows.filter((row) => matchesLibraryPlaceFacets(
    summaries.get(row.canonical_place_id), { areaKeys, taxonomyKeys },
  ))
  const rows = matchingRows.slice(0, input.limit)
  const hasUnreturnedMatch = matchingRows.length > input.limit
  const hasUnscannedRows = result.rows.length > scanLimit
  const cursorRow = hasUnreturnedMatch ? rows.at(-1) : scannedRows.at(-1)
  return {
    schemaVersion: 'library-place-list.v3' as const,
    filter,
    items: rows.map((row) => ({
      placeId: row.canonical_place_id, saved: row.saved, wanted: row.wanted,
      personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
      updatedAt: row.updated_at.toISOString(), place: summaries.get(row.canonical_place_id) ?? null,
    })),
    ...((hasUnreturnedMatch || hasUnscannedRows) && cursorRow !== undefined ? {
      nextCursor: encodePlaceCursor(filter, {
        updatedAt: cursorRow.updated_at.toISOString(), placeId: cursorRow.canonical_place_id,
      }),
    } : {}),
  }
}

export async function getPostgresLibraryPlaceFacets(
  pool: Pool,
  readPlaceSummaries: LibraryPlaceSummaryReader,
  memberId: string,
) {
  const result = await pool.query<SavedPlaceRow>(
    `SELECT canonical_place_id, (count(*) OVER())::int AS saved_place_count
     FROM library.place_preferences
     WHERE membership_id = $1::uuid AND saved
     ORDER BY updated_at DESC, canonical_place_id ASC LIMIT $2`,
    [memberId, libraryFacetSampleLimit],
  )
  const summaries = await summariesById(
    readPlaceSummaries, result.rows.map((row) => row.canonical_place_id),
  )
  return buildLibraryPlaceFacets({
    summaries: [...summaries.values()],
    savedPlaceCount: result.rows[0]?.saved_place_count ?? 0,
    sampledPlaceCount: result.rows.length,
  })
}
