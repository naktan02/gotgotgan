import type { Pool } from 'pg'

import type { LibraryQueries } from '../../application/library-queries.js'
import {
  decodeCollectionCursor,
  decodeCollectionPlaceCursor,
  decodePlaceCursor,
  decodeTagCursor,
  encodeCollectionCursor,
  encodeCollectionPlaceCursor,
  encodePlaceCursor,
  encodeTagCursor,
} from '../../application/library-cursor.js'
import type { LibraryPlaceSummaryReader } from '../../application/ports/library-place-summary-reader.js'
import type {
  LibraryCollectionSummary,
  LibraryPlaceSummary,
} from '../../domain/queries.js'
import { InvalidLibraryQueryError } from '../../domain/queries.js'
import { getPostgresLibraryPlaceOrganization } from './postgres-library-place-organization-query.js'

type PreferenceRow = Readonly<{
  canonical_place_id: string
  saved: boolean
  wanted: boolean
  personal_rating: string | null
  updated_at: Date
}>

type CollectionRow = Readonly<{
  id: string
  name: string
  description: string | null
  visibility: 'private' | 'unlisted' | 'public'
  publication_id: string | null
  place_count: number
  updated_at: Date
}>

type CollectionPlaceRow = Readonly<{
  canonical_place_id: string
  position: number
  added_at: Date
}>

type TagRow = Readonly<{
  id: string
  name: string
  normalized_name: string
  place_count: number
  created_at: Date
}>

function collectionSummary(row: CollectionRow): LibraryCollectionSummary {
  return {
    collectionId: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    publicationId: row.publication_id,
    placeCount: row.place_count,
    updatedAt: row.updated_at.toISOString(),
  }
}

function requireBoundedLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidLibraryQueryError('Library query limit must be between 1 and 50.')
  }
}

function normalizeTagIds(tagIds: readonly string[]): readonly string[] {
  const normalized = [...tagIds].sort()
  if (
    normalized.length > 20 || new Set(normalized).size !== normalized.length ||
    normalized.some((tagId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tagId))
  ) {
    throw new InvalidLibraryQueryError('Library tag filter is invalid.')
  }
  return normalized
}

export class PostgresLibraryQueries implements LibraryQueries {
  constructor(
    private readonly pool: Pool,
    private readonly readPlaceSummaries: LibraryPlaceSummaryReader,
  ) {}

  private async summariesById(placeIds: readonly string[]): Promise<ReadonlyMap<string, LibraryPlaceSummary>> {
    if (placeIds.length === 0) return new Map()
    const summaries = await this.readPlaceSummaries(placeIds)
    const requested = new Set(placeIds)
    return new Map(
      summaries
        .filter((summary) => requested.has(summary.placeId))
        .map((summary) => [summary.placeId, summary]),
    )
  }

  async listPlaces(input: Parameters<LibraryQueries['listPlaces']>[0]) {
    requireBoundedLimit(input.limit)
    if (input.tagMatch !== 'all' && input.tagMatch !== 'any') {
      throw new InvalidLibraryQueryError('Library tag match mode is invalid.')
    }
    const tagIds = normalizeTagIds(input.tagIds)
    const cursor = decodePlaceCursor(input.cursor, {
      state: input.state,
      tagIds,
      tagMatch: input.tagMatch,
    })
    const filter = input.state === 'saved'
      ? 'saved'
      : input.state === 'wanted'
        ? 'wanted'
        : 'personal_rating IS NOT NULL'
    const result = await this.pool.query<PreferenceRow>(
      `
        SELECT canonical_place_id, saved, wanted, personal_rating, updated_at
        FROM library.place_preferences
        WHERE membership_id = $1::uuid
          AND ${filter}
          AND (
            cardinality($4::uuid[]) = 0
            OR (
              $5::text = 'any'
              AND EXISTS (
                SELECT 1
                FROM library.place_tags AS tagged
                WHERE tagged.membership_id = $1::uuid
                  AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
                  AND tagged.tag_id = ANY($4::uuid[])
              )
            )
            OR (
              $5::text = 'all'
              AND (
                SELECT count(*)
                FROM library.place_tags AS tagged
                WHERE tagged.membership_id = $1::uuid
                  AND tagged.canonical_place_id = library.place_preferences.canonical_place_id
                  AND tagged.tag_id = ANY($4::uuid[])
              ) = cardinality($4::uuid[])
            )
          )
          AND (
            $2::timestamptz IS NULL
            OR updated_at < $2::timestamptz
            OR (updated_at = $2::timestamptz AND canonical_place_id > $3::uuid)
          )
        ORDER BY updated_at DESC, canonical_place_id ASC
        LIMIT $6
      `,
      [
        input.memberId,
        cursor?.updatedAt ?? null,
        cursor?.placeId ?? null,
        tagIds,
        input.tagMatch,
        input.limit + 1,
      ],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const summaries = await this.summariesById(rows.map((row) => row.canonical_place_id))
    const last = rows.at(-1)
    return {
      schemaVersion: 'library-place-list.v2' as const,
      filter: {
        state: input.state,
        tagIds,
        tagMatch: input.tagMatch,
      },
      items: rows.map((row) => ({
        placeId: row.canonical_place_id,
        saved: row.saved,
        wanted: row.wanted,
        personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
        updatedAt: row.updated_at.toISOString(),
        place: summaries.get(row.canonical_place_id) ?? null,
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodePlaceCursor({
          state: input.state,
          tagIds,
          tagMatch: input.tagMatch,
        }, {
          updatedAt: last.updated_at.toISOString(),
          placeId: last.canonical_place_id,
        }),
      } : {}),
    }
  }

  async listCollections(input: Parameters<LibraryQueries['listCollections']>[0]) {
    requireBoundedLimit(input.limit)
    const cursor = decodeCollectionCursor(input.cursor)
    const result = await this.pool.query<CollectionRow>(
      `
        SELECT
          collection.id,
          collection.name,
          collection.description,
          collection.visibility,
          collection.publication_id,
          count(place.canonical_place_id)::int AS place_count,
          collection.updated_at
        FROM library.collections AS collection
        LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
        WHERE collection.owner_membership_id = $1::uuid
          AND (
            $2::timestamptz IS NULL
            OR collection.updated_at < $2::timestamptz
            OR (collection.updated_at = $2::timestamptz AND collection.id > $3::uuid)
          )
        GROUP BY collection.id
        ORDER BY collection.updated_at DESC, collection.id ASC
        LIMIT $4
      `,
      [
        input.memberId,
        cursor?.updatedAt ?? null,
        cursor?.collectionId ?? null,
        input.limit + 1,
      ],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const last = rows.at(-1)
    return {
      schemaVersion: 'library-collection-list.v1' as const,
      items: rows.map(collectionSummary),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeCollectionCursor({
          updatedAt: last.updated_at.toISOString(),
          collectionId: last.id,
        }),
      } : {}),
    }
  }

  async getCollection(input: Parameters<LibraryQueries['getCollection']>[0]) {
    requireBoundedLimit(input.limit)
    const cursor = decodeCollectionPlaceCursor(input.cursor, input.collectionId)
    const client = await this.pool.connect()
    let header: CollectionRow | undefined
    let rows: readonly CollectionPlaceRow[] = []
    let hasMore = false
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const collection = await client.query<CollectionRow>(
        `
          SELECT
            collection.id,
            collection.name,
            collection.description,
            collection.visibility,
            collection.publication_id,
            count(place.canonical_place_id)::int AS place_count,
            collection.updated_at
          FROM library.collections AS collection
          LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
          WHERE collection.id = $1::uuid AND collection.owner_membership_id = $2::uuid
          GROUP BY collection.id
        `,
        [input.collectionId, input.memberId],
      )
      header = collection.rows[0]
      if (header !== undefined) {
        const places = await client.query<CollectionPlaceRow>(
          `
            SELECT canonical_place_id, position, added_at
            FROM library.collection_places
            WHERE collection_id = $1::uuid
              AND (
                $2::int IS NULL
                OR position > $2::int
                OR (position = $2::int AND canonical_place_id > $3::uuid)
              )
            ORDER BY position ASC, canonical_place_id ASC
            LIMIT $4
          `,
          [
            input.collectionId,
            cursor?.position ?? null,
            cursor?.placeId ?? null,
            input.limit + 1,
          ],
        )
        hasMore = places.rows.length > input.limit
        rows = hasMore ? places.rows.slice(0, input.limit) : places.rows
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    if (header === undefined) return undefined

    const summaries = await this.summariesById(rows.map((row) => row.canonical_place_id))
    const last = rows.at(-1)
    return {
      schemaVersion: 'library-collection-detail.v1' as const,
      collection: collectionSummary(header),
      places: rows.map((row) => ({
        placeId: row.canonical_place_id,
        position: row.position,
        addedAt: row.added_at.toISOString(),
        place: summaries.get(row.canonical_place_id) ?? null,
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeCollectionPlaceCursor(input.collectionId, {
          position: last.position,
          placeId: last.canonical_place_id,
        }),
      } : {}),
    }
  }

  async listTags(input: Parameters<LibraryQueries['listTags']>[0]) {
    requireBoundedLimit(input.limit)
    const cursor = decodeTagCursor(input.cursor)
    const result = await this.pool.query<TagRow>(
      `
        SELECT
          tag.id,
          tag.name,
          tag.normalized_name,
          count(place.tag_id)::int AS place_count,
          tag.created_at
        FROM library.tags AS tag
        LEFT JOIN library.place_tags AS place
          ON place.tag_id = tag.id AND place.membership_id = tag.owner_membership_id
        WHERE tag.owner_membership_id = $1::uuid
          AND ($2::text IS NULL OR tag.normalized_name > $2::text)
        GROUP BY tag.id
        ORDER BY tag.normalized_name ASC, tag.id ASC
        LIMIT $3
      `,
      [input.memberId, cursor?.normalizedName ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const last = rows.at(-1)
    return {
      schemaVersion: 'library-tag-list.v1' as const,
      items: rows.map((row) => ({
        tagId: row.id,
        name: row.name,
        placeCount: row.place_count,
        createdAt: row.created_at.toISOString(),
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeTagCursor({ normalizedName: last.normalized_name }),
      } : {}),
    }
  }

  async getPlaceOrganization(input: Parameters<LibraryQueries['getPlaceOrganization']>[0]) {
    return getPostgresLibraryPlaceOrganization(this.pool, input)
  }
}
