import type { Pool, PoolClient } from 'pg'

import type { CatalogPlaceMapSource } from '../../application/ports/catalog-place-map-source.js'
import {
  catalogMapDetailZoom,
  type CatalogMapViewport,
  type CatalogPlaceMapFeature,
  type CatalogPlaceMapQuery,
} from '../../domain/catalog-map.js'

type CountRow = Readonly<{ matching_place_count: number }>
type PlaceRow = Readonly<{
  place_id: string
  display_name: string
  area_label: string | null
  latitude: number
  longitude: number
  primary_taxonomy_key: string | null
  primary_taxonomy_label: string | null
}>
type ClusterRow = Readonly<{
  column_index: number
  row_index: number
  latitude: number
  longitude: number
  place_count: number
}>

const matchingCatalogDocuments = `
  WITH matching AS (
    SELECT
      document.place_id,
      document.display_name,
      document.area_label,
      document.location,
      document.primary_taxonomy_key,
      document.primary_taxonomy_label
    FROM search.place_documents AS document
    WHERE document.location IS NOT NULL
      AND ($1::text = '' OR document.search_text % $1::text OR document.search_text LIKE '%' || $1::text || '%')
      AND document.location && ST_MakeEnvelope(-180, $3::double precision, 180, $5::double precision, 4326)
      AND (
        ($2::double precision < $4::double precision AND document.location && ST_MakeEnvelope(
          $2::double precision, $3::double precision, $4::double precision, $5::double precision, 4326
        ))
        OR
        ($2::double precision > $4::double precision AND (
          document.location && ST_MakeEnvelope(
            $2::double precision, $3::double precision, 180, $5::double precision, 4326
          )
          OR document.location && ST_MakeEnvelope(
            -180, $3::double precision, $4::double precision, $5::double precision, 4326
          )
        ))
      )
      AND ($6::jsonb = '[]'::jsonb OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements($6::jsonb) AS area(reference)
        WHERE document.area_key = area.reference->>'key'
          AND document.area_version = (area.reference->>'version')::bigint
      ))
      AND ($7::jsonb = '[]'::jsonb OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements($7::jsonb) AS required_group(candidates)
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(required_group.candidates) AS candidate(reference)
          WHERE document.taxonomy_references @> jsonb_build_array(candidate.reference)
        )
      ))
  )
`

function queryParameters(query: CatalogPlaceMapQuery): unknown[] {
  return [
    query.query.normalize('NFKC').trim().toLocaleLowerCase(),
    query.viewport.west,
    query.viewport.south,
    query.viewport.east,
    query.viewport.north,
    JSON.stringify(query.areaReferences),
    JSON.stringify(query.taxonomyReferenceGroups),
  ]
}

function normalizeLongitude(longitude: number): number {
  if (longitude > 180) return longitude - 360
  if (longitude < -180) return longitude + 360
  return longitude
}

function viewportLongitudeSpan(viewport: CatalogMapViewport): number {
  return viewport.west < viewport.east
    ? viewport.east - viewport.west
    : 360 - viewport.west + viewport.east
}

function clusterBounds(
  viewport: CatalogMapViewport,
  columnIndex: number,
  rowIndex: number,
  columns: number,
  rows: number,
): CatalogMapViewport {
  const longitudeStep = viewportLongitudeSpan(viewport) / columns
  const latitudeStep = (viewport.north - viewport.south) / rows
  return {
    west: columnIndex === 0
      ? viewport.west
      : normalizeLongitude(viewport.west + columnIndex * longitudeStep),
    south: rowIndex === 0 ? viewport.south : viewport.south + rowIndex * latitudeStep,
    east: columnIndex === columns - 1
      ? viewport.east
      : normalizeLongitude(viewport.west + (columnIndex + 1) * longitudeStep),
    north: rowIndex === rows - 1 ? viewport.north : viewport.south + (rowIndex + 1) * latitudeStep,
  }
}

async function readPlaces(client: PoolClient, query: CatalogPlaceMapQuery) {
  const result = await client.query<PlaceRow>(
    `${matchingCatalogDocuments}
     SELECT place_id, display_name, area_label,
            ST_Y(location) AS latitude, ST_X(location) AS longitude,
            primary_taxonomy_key, primary_taxonomy_label
     FROM matching
     ORDER BY place_id`,
    queryParameters(query),
  )
  return result.rows.map((row): CatalogPlaceMapFeature => ({
    kind: 'place',
    featureId: `place:${row.place_id}`,
    placeId: row.place_id,
    name: row.display_name,
    location: { latitude: row.latitude, longitude: row.longitude },
    areaLabel: row.area_label,
    primaryTaxonomy: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null
      ? null
      : { key: row.primary_taxonomy_key, label: row.primary_taxonomy_label },
    placeCount: 1,
  }))
}

async function readClusters(client: PoolClient, query: CatalogPlaceMapQuery) {
  const columns = Math.min(24, query.maxFeatures)
  const rows = Math.max(1, Math.floor(query.maxFeatures / columns))
  const longitudeSpan = viewportLongitudeSpan(query.viewport)
  const result = await client.query<ClusterRow>(
    `${matchingCatalogDocuments}, unwrapped AS (
       SELECT
         CASE WHEN $2::double precision > $4::double precision AND ST_X(location) < $2::double precision
           THEN ST_X(location) + 360 ELSE ST_X(location) END AS longitude,
         ST_Y(location) AS latitude
       FROM matching
     ), cells AS (
       SELECT
         LEAST($8::int - 1, GREATEST(0, FLOOR(
           (longitude - $2::double precision) / $10::double precision * $8::int
         )))::int AS column_index,
         LEAST($9::int - 1, GREATEST(0, FLOOR(
           (latitude - $3::double precision) /
           ($5::double precision - $3::double precision) * $9::int
         )))::int AS row_index,
         longitude,
         latitude
       FROM unwrapped
     )
     SELECT column_index, row_index,
            AVG(latitude)::double precision AS latitude,
            AVG(longitude)::double precision AS longitude,
            COUNT(*)::int AS place_count
     FROM cells
     GROUP BY column_index, row_index
     ORDER BY row_index, column_index`,
    [...queryParameters(query), columns, rows, longitudeSpan],
  )
  return result.rows.map((row): CatalogPlaceMapFeature => ({
    kind: 'cluster',
    featureId: `cluster:${Math.floor(query.zoom)}:${row.column_index}:${row.row_index}`,
    location: {
      latitude: row.latitude,
      longitude: normalizeLongitude(row.longitude),
    },
    bounds: clusterBounds(
      query.viewport,
      row.column_index,
      row.row_index,
      columns,
      rows,
    ),
    placeCount: row.place_count,
  }))
}

export class PostgresCatalogMapSearch implements CatalogPlaceMapSource {
  constructor(private readonly pool: Pool) {}

  async projectCatalogMap(query: CatalogPlaceMapQuery) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const count = await client.query<CountRow>(
        `${matchingCatalogDocuments} SELECT COUNT(*)::int AS matching_place_count FROM matching`,
        queryParameters(query),
      )
      const matchingPlaceCount = count.rows[0]?.matching_place_count ?? 0
      const showPlaces = query.zoom >= catalogMapDetailZoom &&
        matchingPlaceCount <= query.maxFeatures
      const features = showPlaces
        ? await readPlaces(client, query)
        : await readClusters(client, query)
      await client.query('COMMIT')
      return {
        mode: showPlaces ? 'places' as const : 'clusters' as const,
        features,
        matchingPlaceCount,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
