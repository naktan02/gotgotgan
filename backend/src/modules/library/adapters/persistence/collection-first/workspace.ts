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
} from '../../../application/library-place-facets.js'
import type { PersonalLibraryWorkspace } from '../../../application/ports/collection-first.js'
import type {
  LibraryPlaceSummaryReader,
  MemberLibraryPlaceSummaryReader,
} from '../../../application/ports/library-place-summary-reader.js'
import type { PersonalLibraryWorkspaceQuery } from '../../../domain/collection-first.js'
import type { PersonalLibraryMapQuery } from '../../../domain/collection-first.js'
import { normalizePersonalLibraryWorkspaceQuery } from '../../../application/validate-collection-first.js'
import { readWorkspaceMap } from './workspace-map.js'
import { InvalidLibraryQueryError } from '../../../domain/queries.js'
import { matchesFavorite, readFavoriteRows, summariesById } from './favorite-read.js'
import { type CollectionRow, toCollectionWorkspaceSummary } from './collection-record.js'

type FilterUniverseRow = Readonly<{
  canonical_place_id: string
  favorite_place_count: number
}>

export class PostgresPersonalLibraryWorkspace implements PersonalLibraryWorkspace {
  constructor(
    private readonly pool: Pool,
    private readonly readPlaceSummaries: LibraryPlaceSummaryReader,
    private readonly readMemberSummaries?: MemberLibraryPlaceSummaryReader,
  ) {}

  openMap(query: PersonalLibraryMapQuery, signal?: AbortSignal) {
    return readWorkspaceMap(this.pool, this.readPlaceSummaries, this.readMemberSummaries, query, signal)
  }

  async open(input: PersonalLibraryWorkspaceQuery) {
    const query = normalizePersonalLibraryWorkspaceQuery(input)
    let selectedCollection: CollectionRow | undefined
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
    }
    if (query.favoriteScope.kind === 'collection') {
      const owned = await this.pool.query<CollectionRow>(
        `SELECT collection.id, collection.name, collection.description, collection.visibility,
                collection.publication_id, count(placed.canonical_place_id)::int AS place_count,
                collection.revision::text, collection.updated_at
         FROM library.collections AS collection
         LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
         WHERE collection.id = $1::uuid AND collection.owner_membership_id = $2::uuid
         GROUP BY collection.id`,
        [query.favoriteScope.collectionId, query.memberId],
      )
      if (owned.rows[0] === undefined) return undefined
      if (query.includeSelectedCollection) selectedCollection = owned.rows[0]
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
         AND ($5::text = '' OR position($5::text in lower(normalize(collection.name, NFKC))) > 0)
         AND ($2::timestamptz IS NULL OR collection.updated_at < $2::timestamptz
           OR (collection.updated_at = $2::timestamptz AND collection.id > $3::uuid))
       GROUP BY collection.id
       ORDER BY collection.updated_at DESC, collection.id ASC
       LIMIT $4`,
      [query.memberId, collectionCursor?.updatedAt ?? null,
        collectionCursor?.collectionId ?? null, query.limit + 1, query.collectionQuery ?? ''],
    )
    const hasMoreCollections = collectionsResult.rows.length > query.limit
    const collectionRows = collectionsResult.rows.slice(0, query.limit)
    const facetFiltered = query.areaKeys.length > 0 || query.taxonomyKeys.length > 0 || Boolean(query.placeQuery)
    const scanLimit = facetFiltered ? libraryFacetFilterScanLimit : query.limit
    const selectedCollectionId = query.favoriteScope.kind === 'collection'
      ? query.favoriteScope.collectionId
      : null
    const favoriteCandidates = await readFavoriteRows(this.pool, query, placeCursor?.placeId, scanLimit + 1)
    const scannedRows = favoriteCandidates.slice(0, scanLimit)
    const summaries = await summariesById(
      this.readPlaceSummaries,
      scannedRows.map((row) => row.canonical_place_id),
      query.memberId, this.readMemberSummaries,
    )
    const matchingRows = scannedRows.filter((row) => matchesFavorite(
      row, summaries.get(row.canonical_place_id), query,
    ))
    const favoriteRows = matchingRows.slice(0, query.limit)
    const hasUnreturnedMatch = matchingRows.length > query.limit
    const hasUnscannedRows = favoriteCandidates.length > scanLimit
    const favoriteCursorRow = hasUnreturnedMatch ? favoriteRows.at(-1) : scannedRows.at(-1)
    const lastCollection = collectionRows.at(-1)
    const filterUniverseResult = await this.pool.query<FilterUniverseRow>(
      `WITH favorite AS (
         SELECT DISTINCT placed.canonical_place_id
         FROM library.collection_places AS placed
         JOIN library.collections AS collection ON collection.id = placed.collection_id
         WHERE collection.owner_membership_id = $1::uuid
           AND ($3::uuid IS NULL OR collection.id = $3::uuid)
       )
       SELECT canonical_place_id, count(*) OVER()::int AS favorite_place_count
       FROM favorite ORDER BY canonical_place_id ASC LIMIT $2`,
      [query.memberId, libraryFacetSampleLimit, selectedCollectionId],
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
      ...(selectedCollection === undefined ? {} : { selectedCollection: toCollectionWorkspaceSummary(selectedCollection) }),
      filter: {
        ...(query.collectionQuery === undefined ? {} : { collectionQuery: query.collectionQuery }),
        ...(query.placeQuery === undefined ? {} : { placeQuery: query.placeQuery }),
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
