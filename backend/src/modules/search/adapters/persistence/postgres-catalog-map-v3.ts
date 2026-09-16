import type { Pool, PoolClient } from 'pg'
import type { CatalogPlaceMapQueryV3, CatalogPlaceMapSourceV3 } from '../../application/search-catalog-map-v3.js'
import { mapWorldPixels, minimumMapCellPixels, normalizeMapLongitude, type MapFeature, type MapPoint } from '../../../../platform/map-projection/pixel-projection.js'
import { matchingCatalogDocuments, queryParameters } from './postgres-catalog-map-search.js'

type GroupRow = {
  key: string; count: number; latitude: number; longitude: number
  west: number; east: number; south: number; north: number; first_id: string; group_count: number
}
type PointRow = {
  group_key: string; place_id: string; display_name: string; latitude: number; longitude: number
  primary_taxonomy_key: string | null; primary_taxonomy_label: string | null
}
const point = (row: PointRow): MapPoint => ({
  kind: 'place', placeId: row.place_id, label: row.display_name,
  location: { latitude: row.latitude, longitude: row.longitude },
  classification: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null ? null
    : { primaryTaxonomy: { key: row.primary_taxonomy_key, label: row.primary_taxonomy_label }, rootTaxonomy: null },
})

async function groups(client: PoolClient, query: CatalogPlaceMapQueryV3, cellPixels: number, budget: number) {
  return (await client.query<GroupRow>(`${matchingCatalogDocuments(query)}, positioned AS (
    SELECT place_id, ST_Y(location) AS latitude,
      CASE WHEN $2::float8 > $4::float8 AND ST_X(location) < $2::float8 THEN ST_X(location) + 360 ELSE ST_X(location) END AS longitude
    FROM matching WHERE $10::uuid IS NULL OR place_id <> $10::uuid
  ), cells AS (
    SELECT *, floor((longitude + 180) / 360 * $8::float8 / $9::float8)::bigint AS x,
      floor(greatest(0, least($8::float8,
        (1 - ln(tan(pi()/4 + radians(greatest(-85.05112878, least(85.05112878, latitude)))/2))/pi())/2 * $8::float8)) / $9::float8)::bigint AS y
    FROM positioned
  ) SELECT x::text || ':' || y::text AS key, count(*)::int AS count,
    avg(latitude)::float8 AS latitude, avg(longitude)::float8 AS longitude,
    min(longitude) AS west, max(longitude) AS east, min(latitude) AS south, max(latitude) AS north,
    min(place_id::text) AS first_id, count(*) OVER()::int AS group_count
  FROM cells GROUP BY x,y ORDER BY x,y LIMIT $11::int`,
  [...queryParameters(query), mapWorldPixels(query.zoom), cellPixels, query.selectedPlaceId ?? null, budget + 1])).rows
}

async function readPoints(client: PoolClient, query: CatalogPlaceMapQueryV3, rows: readonly GroupRow[]) {
  const wanted = rows.filter((row) => row.count === 1 || (row.west === row.east && row.south === row.north))
    .map((row) => ({ key: row.key, id: row.first_id, latitude: row.south, longitude: normalizeMapLongitude(row.west), coincident: row.count > 1 }))
  if (query.selectedPlaceId !== undefined) wanted.push({ key: 'selected', id: query.selectedPlaceId, latitude: 0, longitude: 0, coincident: false })
  if (wanted.length === 0) return []
  return (await client.query<PointRow>(`${matchingCatalogDocuments(query)}
    SELECT chosen.key AS group_key, place.* FROM jsonb_to_recordset($8::jsonb)
      AS chosen(key text, id uuid, latitude float8, longitude float8, coincident boolean)
    CROSS JOIN LATERAL (
      SELECT place_id, display_name, ST_Y(location) AS latitude, ST_X(location) AS longitude,
        primary_taxonomy_key, primary_taxonomy_label FROM matching
      WHERE (CASE WHEN chosen.coincident THEN ST_Y(location) = chosen.latitude AND ST_X(location) = chosen.longitude
        AND ($9::uuid IS NULL OR place_id <> $9::uuid) ELSE place_id = chosen.id END)
      ORDER BY place_id LIMIT 20
    ) AS place ORDER BY chosen.key, place.place_id`,
  [...queryParameters(query), JSON.stringify(wanted), query.selectedPlaceId ?? null])).rows
}

/** SQL aggregation retains all matches while only bounded groups and 20 coordinate choices cross the DB boundary. */
export class PostgresCatalogMapSearchV3 implements CatalogPlaceMapSourceV3 {
  constructor(private readonly pool: Pool) {}
  async projectCatalogMapV3(query: CatalogPlaceMapQueryV3) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await client.query("SET LOCAL statement_timeout = '5s'")
      const counted = await client.query<{ count: number }>(`${matchingCatalogDocuments(query)} SELECT count(*)::int AS count FROM matching`, queryParameters(query))
      const matchingPlaceCount = counted.rows[0]?.count ?? 0
      // A one-feature budget cannot reserve a separate selection; coverage takes precedence.
      const effective = query.maxFeatures === 1 ? { ...query, selectedPlaceId: undefined } : query
      const budget = query.maxFeatures - (effective.selectedPlaceId === undefined ? 0 : 1)
      let cellPixels = minimumMapCellPixels
      let rows = await groups(client, effective, cellPixels, budget)
      while (rows.length > budget) {
        cellPixels *= 2 ** Math.max(1, Math.ceil(Math.log2(Math.sqrt((rows[0]?.group_count ?? rows.length) / budget))))
        rows = await groups(client, effective, cellPixels, budget)
      }
      const points = await readPoints(client, effective, rows)
      const byGroup = new Map<string, MapPoint[]>()
      for (const row of points) byGroup.set(row.group_key, [...(byGroup.get(row.group_key) ?? []), point(row)])
      const features: MapFeature[] = [...(byGroup.get('selected') ?? [])]
      for (const row of rows) {
        const preview = byGroup.get(row.key) ?? []
        if (row.count === 1) {
          if (preview[0] === undefined) throw new Error('Map singleton metadata missing.')
          features.push(preview[0]); continue
        }
        const coincident = row.west === row.east && row.south === row.north
        const padding = 0.00001
        features.push({ kind: 'cluster', clusterId: `p${cellPixels}-z${query.zoom}-${row.key}`, count: row.count,
          location: coincident ? { latitude: row.south, longitude: normalizeMapLongitude(row.west) }
            : { latitude: row.latitude, longitude: normalizeMapLongitude(row.longitude) },
          bounds: { west: normalizeMapLongitude(row.west - (row.west === row.east ? padding : 0)),
            east: normalizeMapLongitude(row.east + (row.west === row.east ? padding : 0)),
            south: Math.max(query.viewport.south, row.south - (row.south === row.north ? padding : 0)),
            north: Math.min(query.viewport.north, row.north + (row.south === row.north ? padding : 0)) },
          coincidentPreview: coincident ? { places: preview, remainingCount: row.count - preview.length } : null,
        })
      }
      await client.query('COMMIT')
      return { features, matchingPlaceCount }
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
    finally { client.release() }
  }
}
