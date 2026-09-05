import type { Pool } from 'pg'

import {
  decodeWorkspaceCollectionCursor,
  decodeWorkspaceFavoriteCursor,
  encodeWorkspaceCollectionCursor,
  encodeWorkspaceFavoriteCursor,
} from '../../../application/collection-first-cursor.js'
import {
  buildLibraryPlaceFacets,
  libraryFacetFilterScanLimit,
  libraryFacetSampleLimit,
  matchesLibraryPlaceFacets,
} from '../../../application/library-place-facets.js'
import type { PersonalLibraryWorkspace } from '../../../application/ports/collection-first.js'
import type {
  LibraryPlaceSummaryReader,
  MemberLibraryPlaceSummaryReader,
} from '../../../application/ports/library-place-summary-reader.js'
import type { PersonalLibraryWorkspaceQuery } from '../../../domain/collection-first.js'
import { InvalidLibraryQueryError, type LibraryPlaceSummary } from '../../../domain/queries.js'
import { type CollectionRow, toCollectionWorkspaceSummary } from './collection-record.js'

type FavoriteRow = Readonly<{
  canonical_place_id: string
  collection_count: number
  tag_ids: string[]
  personal_rating: string | null
}>

type FilterUniverseRow = Readonly<{
  canonical_place_id: string
  favorite_place_count: number
}>

async function summariesById(
  read: LibraryPlaceSummaryReader,
  placeIds: readonly string[],
  memberId: string,
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

export class PostgresPersonalLibraryWorkspace implements PersonalLibraryWorkspace {
  constructor(
    private readonly pool: Pool,
    private readonly readPlaceSummaries: LibraryPlaceSummaryReader,
    private readonly readMemberSummaries?: MemberLibraryPlaceSummaryReader,
  ) {}

  async open(query: PersonalLibraryWorkspaceQuery) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
    }
    if (query.favoriteScope.kind === 'collection') {
      const owned = await this.pool.query(
        `SELECT 1 FROM library.collections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [query.favoriteScope.collectionId, query.memberId],
      )
      if (owned.rows[0] === undefined) return undefined
    }
    const collectionCursor = decodeWorkspaceCollectionCursor(query.collectionCursor, query)
    const placeCursor = decodeWorkspaceFavoriteCursor(query.placeCursor, query)
    const collectionsResult = await this.pool.query<CollectionRow>(
      `SELECT collection.id, collection.name, collection.description, collection.visibility,
              collection.publication_id, count(placed.canonical_place_id)::int AS place_count,
              collection.revision::text, collection.updated_at
       FROM library.collections AS collection
       LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
       WHERE collection.owner_membership_id = $1::uuid
         AND ($2::timestamptz IS NULL OR collection.updated_at < $2::timestamptz
           OR (collection.updated_at = $2::timestamptz AND collection.id > $3::uuid))
       GROUP BY collection.id
       ORDER BY collection.updated_at DESC, collection.id ASC
       LIMIT $4`,
      [query.memberId, collectionCursor?.updatedAt ?? null,
        collectionCursor?.collectionId ?? null, query.limit + 1],
    )
    const hasMoreCollections = collectionsResult.rows.length > query.limit
    const collectionRows = collectionsResult.rows.slice(0, query.limit)
    const facetFiltered = query.areaKeys.length > 0 || query.taxonomyKeys.length > 0
    const scanLimit = facetFiltered ? libraryFacetFilterScanLimit : query.limit
    const selectedCollectionId = query.favoriteScope.kind === 'collection'
      ? query.favoriteScope.collectionId
      : null
    const favoritesResult = await this.pool.query<FavoriteRow>(
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
              preference.personal_rating
       FROM candidates AS candidate
       LEFT JOIN library.place_preferences AS preference
         ON preference.membership_id = $1::uuid AND preference.canonical_place_id = candidate.canonical_place_id
       LEFT JOIN library.place_tags AS tagged
         ON tagged.membership_id = $1::uuid AND tagged.canonical_place_id = candidate.canonical_place_id
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
      [query.memberId, selectedCollectionId, placeCursor?.placeId ?? null,
        query.ratingFilter.kind, query.tagIds, query.tagMatch, scanLimit + 1],
    )
    const scannedRows = favoritesResult.rows.slice(0, scanLimit)
    const summaries = await summariesById(
      this.readPlaceSummaries,
      scannedRows.map((row) => row.canonical_place_id),
      query.memberId, this.readMemberSummaries,
    )
    const matchingRows = scannedRows.filter((row) => matchesLibraryPlaceFacets(
      summaries.get(row.canonical_place_id),
      { areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys },
    ))
    const favoriteRows = matchingRows.slice(0, query.limit)
    const hasUnreturnedMatch = matchingRows.length > query.limit
    const hasUnscannedRows = favoritesResult.rows.length > scanLimit
    const favoriteCursorRow = hasUnreturnedMatch ? favoriteRows.at(-1) : scannedRows.at(-1)
    const lastCollection = collectionRows.at(-1)
    const filterUniverseResult = await this.pool.query<FilterUniverseRow>(
      `WITH favorite AS (
         SELECT DISTINCT placed.canonical_place_id
         FROM library.collection_places AS placed
         JOIN library.collections AS collection ON collection.id = placed.collection_id
         WHERE collection.owner_membership_id = $1::uuid
       )
       SELECT canonical_place_id, count(*) OVER()::int AS favorite_place_count
       FROM favorite ORDER BY canonical_place_id ASC LIMIT $2`,
      [query.memberId, libraryFacetSampleLimit],
    )
    const filterSummaries = await summariesById(
      this.readPlaceSummaries,
      filterUniverseResult.rows.map((row) => row.canonical_place_id),
      query.memberId, this.readMemberSummaries,
    )
    const availableFacets = buildLibraryPlaceFacets({
      summaries: [...filterSummaries.values()],
      savedPlaceCount: filterUniverseResult.rows[0]?.favorite_place_count ?? 0,
      sampledPlaceCount: filterUniverseResult.rows.length,
    })
    return {
      schemaVersion: 'personal-library-workspace.v2' as const,
      filter: {
        favoriteScope: query.favoriteScope, ratingFilter: query.ratingFilter,
        tagIds: query.tagIds, tagMatch: query.tagMatch,
        areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys,
      },
      collections: {
        items: collectionRows.map(toCollectionWorkspaceSummary),
        ...(hasMoreCollections && lastCollection !== undefined ? {
          nextCursor: encodeWorkspaceCollectionCursor(query, {
            updatedAt: lastCollection.updated_at.toISOString(), collectionId: lastCollection.id,
          }),
        } : {}),
      },
      favoritePlaces: {
        items: favoriteRows.map((row) => ({
          placeId: row.canonical_place_id,
          collectionMembershipCount: row.collection_count,
          tagIds: row.tag_ids,
          personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
          place: summaries.get(row.canonical_place_id) ?? null,
        })),
        ...((hasUnreturnedMatch || hasUnscannedRows) && favoriteCursorRow !== undefined ? {
          nextCursor: encodeWorkspaceFavoriteCursor(query, { placeId: favoriteCursorRow.canonical_place_id }),
        } : {}),
      },
      availableFilters: {
        coverage: {
          favoritePlaceCount: availableFacets.coverage.savedPlaceCount,
          sampledPlaceCount: availableFacets.coverage.sampledPlaceCount,
          projectedPlaceCount: availableFacets.coverage.projectedPlaceCount,
          complete: availableFacets.coverage.complete,
        },
        areas: availableFacets.areas,
        taxonomies: availableFacets.taxonomies,
      },
    }
  }
}
