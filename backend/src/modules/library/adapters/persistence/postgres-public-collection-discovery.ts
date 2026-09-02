import type { Pool } from 'pg'

import { collectionVersion } from '../../application/collection-version.js'
import {
  decodeDiscoverableCollectionCursor,
  decodePublicCollectionDirectoryCursor,
  encodeDiscoverableCollectionCursor,
  encodePublicCollectionDirectoryCursor,
  type DirectoryAnchor,
} from '../../application/public-collection-cursor.js'
import type { LibraryPlaceSummaryReader } from '../../application/ports/library-place-summary-reader.js'
import type { PublicCollectionDiscovery } from '../../application/ports/public-collection-discovery.js'
import type {
  PublicCollectionDiscoveryQuery,
  PublicCollectionDiscoverySort,
  PublicCollectionTopic,
} from '../../domain/public-collection-discovery.js'
import { InvalidLibraryQueryError, type LibraryPlaceSummary } from '../../domain/queries.js'

type CollectionRow = Readonly<{
  id: string
  publication_id: string
  name: string
  normalized_name: string
  description: string | null
  revision: string
  place_count: number
  updated_at: Date
  handle: string
  display_name: string
}>

type CollectionPlaceRow = Readonly<{
  collection_id: string
  canonical_place_id: string
  position: number
}>

type TopicRow = Readonly<{
  collection_id: string
  topic_key: string
  label: string
  ordinal: number
}>

type FacetRow = Readonly<{ key: string; label: string; count: number }>

const discoverableOwnerJoinsSql = `
  JOIN profiles.public_profiles AS profile
    ON profile.membership_id = collection.owner_membership_id
   AND profile.visibility = 'public'
  LEFT JOIN profiles.public_profile_moderation AS moderation
    ON moderation.handle = profile.handle
`

const discoverableOwnerPredicateSql = `collection.visibility = 'public'
  AND collection.publication_id IS NOT NULL
  AND coalesce(moderation.state, 'allowed') = 'allowed'`

function requireQuery(input: Readonly<{ limit: number }>): void {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new InvalidLibraryQueryError('Public Collection limit must be between 1 and 50.')
  }
}

function literalPattern(value: string | null): string | null {
  return value === null ? null : `%${value.replace(/[\\%_]/g, '\\$&').toLowerCase()}%`
}

async function summariesById(
  read: LibraryPlaceSummaryReader,
  placeIds: readonly string[],
): Promise<ReadonlyMap<string, LibraryPlaceSummary>> {
  const requested = new Set(placeIds)
  if (requested.size === 0) return new Map()
  return new Map((await read([...requested]))
    .filter((summary) => requested.has(summary.placeId))
    .map((summary) => [summary.placeId, summary]))
}

function directoryOrder(sort: PublicCollectionDiscoverySort): string {
  if (sort === 'largest') return 'place_count DESC, updated_at DESC, id ASC'
  if (sort === 'name') return 'normalized_name ASC, id ASC'
  return 'updated_at DESC, id ASC'
}

function directoryCursorPredicate(sort: PublicCollectionDiscoverySort): string {
  if (sort === 'largest') return `(
    $7::int IS NULL OR place_count < $7::int OR
    (place_count = $7::int AND (
      updated_at < $5::timestamptz OR
      (updated_at = $5::timestamptz AND id > $6::uuid)
    ))
  )`
  if (sort === 'name') return `(
    $8::text IS NULL OR normalized_name > $8::text OR
    (normalized_name = $8::text AND id > $6::uuid)
  )`
  return `(
    $5::timestamptz IS NULL OR updated_at < $5::timestamptz OR
    (updated_at = $5::timestamptz AND id > $6::uuid)
  )`
}

function anchor(row: CollectionRow, sort: PublicCollectionDiscoverySort): DirectoryAnchor {
  if (sort === 'largest') {
    return {
      sort, placeCount: row.place_count, updatedAt: row.updated_at.toISOString(),
      collectionId: row.id,
    }
  }
  if (sort === 'name') {
    return { sort, normalizedName: row.normalized_name, collectionId: row.id }
  }
  return { sort, updatedAt: row.updated_at.toISOString(), collectionId: row.id }
}

export class PostgresPublicCollectionDiscovery implements PublicCollectionDiscovery {
  constructor(
    private readonly pool: Pool,
    private readonly readPlaceSummaries: LibraryPlaceSummaryReader,
  ) {}

  async list(query: PublicCollectionDiscoveryQuery) {
    requireQuery(query)
    const filter = {
      q: query.q,
      areaKeys: [...query.areaKeys].sort(),
      taxonomyKeys: [...query.taxonomyKeys].sort(),
      topicKeys: [...query.topicKeys].sort(),
      sort: query.sort,
    }
    const cursor = decodePublicCollectionDirectoryCursor(query.cursor, filter)
    const updatedAt = cursor !== undefined && cursor.sort !== 'name' ? cursor.updatedAt : null
    const collectionId = cursor?.collectionId ?? null
    const placeCount = cursor?.sort === 'largest' ? cursor.placeCount : null
    const normalizedName = cursor?.sort === 'name' ? cursor.normalizedName : null
    const collections = await this.pool.query<CollectionRow>(
      `WITH cursor_input AS (
         SELECT $5::timestamptz AS cursor_updated_at, $6::uuid AS cursor_collection_id,
                $7::int AS cursor_place_count, $8::text AS cursor_normalized_name
       ), eligible AS (
         SELECT collection.id, collection.publication_id, collection.name,
                lower(collection.name) AS normalized_name, collection.description,
                collection.revision::text,
                count(placed.canonical_place_id)::int AS place_count,
                collection.updated_at, profile.handle, profile.display_name
         FROM library.collections AS collection
         ${discoverableOwnerJoinsSql}
         LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
         WHERE ${discoverableOwnerPredicateSql}
           AND ($1::text IS NULL OR
             lower(collection.name) LIKE $1::text ESCAPE '\\' OR
             lower(coalesce(collection.description, '')) LIKE $1::text ESCAPE '\\' OR
             lower(profile.display_name) LIKE $1::text ESCAPE '\\' OR
             EXISTS (
               SELECT 1 FROM library.collection_discovery_topics AS searched_topic
               WHERE searched_topic.collection_id = collection.id
                 AND lower(searched_topic.label) LIKE $1::text ESCAPE '\\'
             )
           )
           AND (cardinality($2::text[]) = 0 OR EXISTS (
             SELECT 1
             FROM library.collection_places AS area_place
             JOIN search.place_documents AS area_document
               ON area_document.place_id = area_place.canonical_place_id
             WHERE area_place.collection_id = collection.id
               AND area_document.area_key = ANY($2::text[])
           ))
           AND (cardinality($3::text[]) = 0 OR EXISTS (
             SELECT 1
             FROM library.collection_places AS taxonomy_place
             JOIN search.place_documents AS taxonomy_document
               ON taxonomy_document.place_id = taxonomy_place.canonical_place_id
             WHERE taxonomy_place.collection_id = collection.id
               AND taxonomy_document.taxonomy_keys && $3::text[]
           ))
           AND (cardinality($4::text[]) = 0 OR EXISTS (
             SELECT 1 FROM library.collection_discovery_topics AS selected_topic
             WHERE selected_topic.collection_id = collection.id
               AND selected_topic.topic_key = ANY($4::text[])
           ))
         GROUP BY collection.id, profile.handle, profile.display_name
       )
       SELECT id, publication_id, name, normalized_name, description, revision, place_count,
              updated_at, handle, display_name
       FROM eligible CROSS JOIN cursor_input
       WHERE ${directoryCursorPredicate(query.sort)}
       ORDER BY ${directoryOrder(query.sort)}
       LIMIT $9`,
      [literalPattern(query.q), filter.areaKeys, filter.taxonomyKeys, filter.topicKeys,
        updatedAt, collectionId, placeCount, normalizedName, query.limit + 1],
    )
    const hasMore = collections.rows.length > query.limit
    const rows = hasMore ? collections.rows.slice(0, query.limit) : collections.rows
    const collectionIds = rows.map((row) => row.id)
    const [places, topics, availableFilters] = await Promise.all([
      this.readPreviewPlaces(collectionIds),
      this.readTopics(collectionIds),
      this.readAvailableFilters(),
    ])
    const summaries = await summariesById(
      this.readPlaceSummaries,
      places.map((place) => place.canonical_place_id),
    )
    const last = rows.at(-1)
    return {
      filter,
      items: rows.map((row) => ({
        publicationId: row.publication_id,
        publicationVersion: collectionVersion(row.id, row.revision),
        name: row.name,
        description: row.description,
        placeCount: row.place_count,
        updatedAt: row.updated_at.toISOString(),
        owner: { handle: row.handle, displayName: row.display_name },
        topics: topics.get(row.id) ?? [],
        previewPlaces: places.filter((place) => place.collection_id === row.id).map((place) => ({
          placeId: place.canonical_place_id,
          position: place.position,
          place: summaries.get(place.canonical_place_id) ?? null,
        })),
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodePublicCollectionDirectoryCursor(filter, anchor(last, query.sort)),
      } : {}),
      availableFilters,
    }
  }

  async get(query: Parameters<PublicCollectionDiscovery['get']>[0]) {
    requireQuery(query)
    const client = await this.pool.connect()
    let row: CollectionRow | undefined
    let places: readonly CollectionPlaceRow[] = []
    let topics: readonly PublicCollectionTopic[] = []
    let hasMore = false
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const collection = await client.query<CollectionRow>(
        `SELECT collection.id, collection.publication_id, collection.name,
                lower(collection.name) AS normalized_name,
                collection.description, collection.revision::text,
                count(placed.canonical_place_id)::int AS place_count,
                collection.updated_at, profile.handle, profile.display_name
         FROM library.collections AS collection
         ${discoverableOwnerJoinsSql}
         LEFT JOIN library.collection_places AS placed ON placed.collection_id = collection.id
         WHERE ${discoverableOwnerPredicateSql}
           AND collection.publication_id = $1::uuid
         GROUP BY collection.id, profile.handle, profile.display_name`,
        [query.publicationId],
      )
      row = collection.rows[0]
      if (row !== undefined) {
        const version = collectionVersion(row.id, row.revision)
        const cursor = decodeDiscoverableCollectionCursor(
          query.cursor, query.publicationId, version,
        )
        const result = await client.query<CollectionPlaceRow>(
          `SELECT collection_id, canonical_place_id, position
           FROM library.collection_places
           WHERE collection_id = $1::uuid
             AND ($2::int IS NULL OR position > $2::int OR
               (position = $2::int AND canonical_place_id > $3::uuid))
           ORDER BY position, canonical_place_id
           LIMIT $4`,
          [row.id, cursor?.position ?? null, cursor?.placeId ?? null, query.limit + 1],
        )
        hasMore = result.rows.length > query.limit
        places = hasMore ? result.rows.slice(0, query.limit) : result.rows
        const topicResult = await client.query<TopicRow>(
          `SELECT collection_id, topic_key, label, ordinal
           FROM library.collection_discovery_topics
           WHERE collection_id = $1::uuid ORDER BY ordinal`,
          [row.id],
        )
        topics = topicResult.rows.map((topic) => ({ key: topic.topic_key, label: topic.label }))
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    if (row === undefined) return undefined
    const version = collectionVersion(row.id, row.revision)
    const summaries = await summariesById(
      this.readPlaceSummaries,
      places.map((place) => place.canonical_place_id),
    )
    const last = places.at(-1)
    return {
      publicationId: row.publication_id,
      publicationVersion: version,
      name: row.name,
      description: row.description,
      placeCount: row.place_count,
      updatedAt: row.updated_at.toISOString(),
      owner: { handle: row.handle, displayName: row.display_name },
      topics,
      places: places.map((place) => ({
        placeId: place.canonical_place_id,
        position: place.position,
        place: summaries.get(place.canonical_place_id) ?? null,
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeDiscoverableCollectionCursor(query.publicationId, version, {
          position: last.position, placeId: last.canonical_place_id,
        }),
      } : {}),
    }
  }

  private async readPreviewPlaces(collectionIds: readonly string[]): Promise<readonly CollectionPlaceRow[]> {
    if (collectionIds.length === 0) return []
    const result = await this.pool.query<CollectionPlaceRow>(
      `SELECT collection_id, canonical_place_id, position
       FROM (
         SELECT placed.collection_id, placed.canonical_place_id, placed.position,
                row_number() OVER (
                  PARTITION BY placed.collection_id ORDER BY placed.position, placed.canonical_place_id
                ) AS preview_rank
         FROM library.collection_places AS placed
         WHERE placed.collection_id = ANY($1::uuid[])
       ) AS preview
       WHERE preview_rank <= 6
       ORDER BY collection_id, position, canonical_place_id`,
      [collectionIds],
    )
    return result.rows
  }

  private async readTopics(collectionIds: readonly string[]): Promise<ReadonlyMap<string, readonly PublicCollectionTopic[]>> {
    if (collectionIds.length === 0) return new Map()
    const result = await this.pool.query<TopicRow>(
      `SELECT collection_id, topic_key, label, ordinal
       FROM library.collection_discovery_topics
       WHERE collection_id = ANY($1::uuid[])
       ORDER BY collection_id, ordinal`,
      [collectionIds],
    )
    const topics = new Map<string, PublicCollectionTopic[]>()
    for (const row of result.rows) {
      const values = topics.get(row.collection_id) ?? []
      values.push({ key: row.topic_key, label: row.label })
      topics.set(row.collection_id, values)
    }
    return topics
  }

  private async readAvailableFilters() {
    const [areas, taxonomies, topics] = await Promise.all([
      this.pool.query<FacetRow>(
        `SELECT document.area_key AS key,
                coalesce(max(document.area_label), document.area_key) AS label,
                count(DISTINCT collection.id)::int AS count
         FROM library.collections AS collection
         ${discoverableOwnerJoinsSql}
         JOIN library.collection_places AS placed ON placed.collection_id = collection.id
         JOIN search.place_documents AS document ON document.place_id = placed.canonical_place_id
         WHERE ${discoverableOwnerPredicateSql}
           AND document.area_key IS NOT NULL
         GROUP BY document.area_key ORDER BY count DESC, key ASC LIMIT 50`,
      ),
      this.pool.query<FacetRow>(
        `SELECT taxonomy_key AS key,
                coalesce(max(document.primary_taxonomy_label)
                  FILTER (WHERE document.primary_taxonomy_key = taxonomy_key), taxonomy_key) AS label,
                count(DISTINCT collection.id)::int AS count
         FROM library.collections AS collection
         ${discoverableOwnerJoinsSql}
         JOIN library.collection_places AS placed ON placed.collection_id = collection.id
         JOIN search.place_documents AS document ON document.place_id = placed.canonical_place_id
         CROSS JOIN LATERAL unnest(document.taxonomy_keys) AS taxonomy_key
         WHERE ${discoverableOwnerPredicateSql}
         GROUP BY taxonomy_key ORDER BY count DESC, key ASC LIMIT 50`,
      ),
      this.pool.query<FacetRow>(
        `SELECT topic.topic_key AS key, max(topic.label) AS label,
                count(DISTINCT collection.id)::int AS count
         FROM library.collections AS collection
         ${discoverableOwnerJoinsSql}
         JOIN library.collection_discovery_topics AS topic ON topic.collection_id = collection.id
         WHERE ${discoverableOwnerPredicateSql}
         GROUP BY topic.topic_key ORDER BY count DESC, key ASC LIMIT 50`,
      ),
    ])
    return { areas: areas.rows, taxonomies: taxonomies.rows, topics: topics.rows }
  }
}
