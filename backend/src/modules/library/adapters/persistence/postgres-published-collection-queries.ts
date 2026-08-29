import type { Pool } from 'pg'

import {
  decodePublishedCollectionCursor,
  encodePublishedCollectionCursor,
} from '../../application/library-cursor.js'
import { projectLibraryMapFeatures } from '../../application/library-map-features.js'
import type { LibraryQueries } from '../../application/library-queries.js'
import type { LibraryMapPlaceReader } from '../../application/ports/library-map-place-reader.js'
import type { LibraryPlaceSummaryReader } from '../../application/ports/library-place-summary-reader.js'
import type { LibraryPlaceSummary } from '../../domain/queries.js'
import { InvalidLibraryQueryError } from '../../domain/queries.js'

type PublishedCollectionMetadataRow = Readonly<{
  id: string
  name: string
  description: string | null
  visibility: 'unlisted' | 'public'
  place_count: number
  updated_at: Date
}>

type PublishedCollectionPlaceRow = Readonly<{
  canonical_place_id: string
  position: number
}>

type PublishedCollectionMapRow = PublishedCollectionMetadataRow & Readonly<{
  place_ids: string[]
}>

function requireBoundedLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidLibraryQueryError('Published Collection limit must be between 1 and 50.')
  }
}

function requireViewport(input: Parameters<LibraryQueries['getPublishedCollectionMap']>[0]): void {
  const { bounds, zoom } = input
  if (
    !Number.isInteger(zoom) || zoom < 0 || zoom > 22 ||
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
    bounds.west < -180 || bounds.east > 180 || bounds.west >= bounds.east ||
    bounds.south < -90 || bounds.north > 90 || bounds.south >= bounds.north
  ) throw new InvalidLibraryQueryError('Published Collection map viewport is invalid.')
}

async function summariesById(
  readPlaceSummaries: LibraryPlaceSummaryReader,
  placeIds: readonly string[],
): Promise<ReadonlyMap<string, LibraryPlaceSummary>> {
  const requested = new Set(placeIds)
  if (requested.size === 0) return new Map()
  return new Map(
    (await readPlaceSummaries([...requested]))
      .filter((summary) => requested.has(summary.placeId))
      .map((summary) => [summary.placeId, summary]),
  )
}

export async function getPostgresPublishedCollection(
  pool: Pool,
  readPlaceSummaries: LibraryPlaceSummaryReader,
  input: Parameters<LibraryQueries['getPublishedCollection']>[0],
) {
  requireBoundedLimit(input.limit)
  const metadata = await pool.query<PublishedCollectionMetadataRow>(
    `
      SELECT
        collection.id,
        collection.name,
        collection.description,
        collection.visibility,
        count(place.canonical_place_id)::int AS place_count,
        collection.updated_at
      FROM library.collections AS collection
      LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
      WHERE collection.publication_id = $1::uuid
        AND collection.visibility IN ('unlisted', 'public')
      GROUP BY collection.id
    `,
    [input.publicationId],
  )
  const collection = metadata.rows[0]
  if (collection === undefined) return undefined
  const updatedAt = collection.updated_at.toISOString()
  const cursor = decodePublishedCollectionCursor(input.cursor, input.publicationId, updatedAt)
  const result = await pool.query<PublishedCollectionPlaceRow>(
    `
      SELECT canonical_place_id, position
      FROM library.collection_places
      WHERE collection_id = $1::uuid
        AND (
          $2::int IS NULL
          OR position > $2::int
          OR (position = $2::int AND canonical_place_id > $3::uuid)
        )
      ORDER BY position, canonical_place_id
      LIMIT $4
    `,
    [collection.id, cursor?.position ?? null, cursor?.placeId ?? null, input.limit + 1],
  )
  const hasMore = result.rows.length > input.limit
  const rows = result.rows.slice(0, input.limit)
  const summaries = await summariesById(
    readPlaceSummaries,
    rows.map((row) => row.canonical_place_id),
  )
  const last = rows.at(-1)
  return {
    publicationId: input.publicationId,
    visibility: collection.visibility,
    name: collection.name,
    description: collection.description,
    placeCount: collection.place_count,
    places: rows.map((row) => ({
      placeId: row.canonical_place_id,
      position: row.position,
      place: summaries.get(row.canonical_place_id) ?? null,
    })),
    ...(hasMore && last !== undefined ? {
      nextCursor: encodePublishedCollectionCursor(input.publicationId, updatedAt, {
        position: last.position,
        placeId: last.canonical_place_id,
      }),
    } : {}),
    updatedAt,
  }
}

export async function getPostgresPublishedCollectionMap(
  pool: Pool,
  readMapPlaces: LibraryMapPlaceReader,
  input: Parameters<LibraryQueries['getPublishedCollectionMap']>[0],
) {
  requireViewport(input)
  const result = await pool.query<PublishedCollectionMapRow>(
    `
      SELECT
        collection.id,
        collection.name,
        collection.description,
        collection.visibility,
        count(place.canonical_place_id)::int AS place_count,
        collection.updated_at,
        coalesce(
          array_agg(place.canonical_place_id ORDER BY place.position, place.canonical_place_id)
            FILTER (WHERE place.canonical_place_id IS NOT NULL),
          ARRAY[]::uuid[]
        ) AS place_ids
      FROM library.collections AS collection
      LEFT JOIN library.collection_places AS place ON place.collection_id = collection.id
      WHERE collection.publication_id = $1::uuid
        AND collection.visibility IN ('unlisted', 'public')
      GROUP BY collection.id
    `,
    [input.publicationId],
  )
  const collection = result.rows[0]
  if (collection === undefined) return undefined
  const read = await readMapPlaces({ placeIds: collection.place_ids, bounds: input.bounds })
  const requested = new Set(collection.place_ids)
  const features = projectLibraryMapFeatures({
    places: read.places.filter((place) => requested.has(place.placeId)),
    bounds: input.bounds,
    zoom: input.zoom,
  })
  const representedPlaceCount = features.reduce((count, feature) => (
    count + (feature.kind === 'place' ? 1 : feature.count)
  ), 0)
  return {
    schemaVersion: 'place-published-collection-map.v1' as const,
    publicationId: input.publicationId,
    viewport: { bounds: input.bounds, zoom: input.zoom },
    features,
    coverage: {
      representedPlaceCount,
      unprojectedPlaceCount: read.unprojectedPlaceCount,
      complete: read.unprojectedPlaceCount === 0,
    },
  }
}
