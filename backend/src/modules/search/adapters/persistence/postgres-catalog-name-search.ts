import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

import type { CatalogPlaceSearchQuery } from '../../domain/catalog-home-search.js'
import { InvalidSearchCursorError } from '../../domain/model.js'
import { type CatalogSearchRow, toCatalogPlaceSummary } from './postgres-search-projection-reader.js'

type NameRow = CatalogSearchRow & Readonly<{ distance_m: number | null }>
type NameCursor = Readonly<{
  version: 2
  queryFingerprint: string
  score: number
  distance: number | null
  placeId: string
}>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function decodeCursor(value: string | undefined, queryFingerprint: string): NameCursor | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('version' in parsed) || parsed.version !== 2 ||
      !('queryFingerprint' in parsed) || parsed.queryFingerprint !== queryFingerprint ||
      !('score' in parsed) || typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) ||
      !('distance' in parsed) || !(parsed.distance === null || (
        typeof parsed.distance === 'number' && Number.isFinite(parsed.distance) && parsed.distance >= 0
      )) ||
      !('placeId' in parsed) || typeof parsed.placeId !== 'string' || !uuid.test(parsed.placeId)
    ) throw new Error('Invalid name cursor')
    return parsed as NameCursor
  } catch {
    throw new InvalidSearchCursorError('Catalog name cursor is invalid for this query.')
  }
}

// This private name-only path does not change the frozen v1 text ranking or cursor.
export async function searchCatalogNames(pool: Pool, query: CatalogPlaceSearchQuery) {
  const normalizedQuery = query.query.normalize('NFKC').trim().toLocaleLowerCase()
  const areaReferences = query.areaReferences ?? (query.areaReference === undefined ? [] : [query.areaReference])
  const taxonomyReferenceGroups = query.taxonomyReferenceGroups ??
    query.taxonomyReferences.map((reference) => [{ ...reference, kind: 'category' as const }])
  const queryFingerprint = createHash('sha256').update(JSON.stringify({
    intent: 'name',
    query: normalizedQuery,
    near: query.near === undefined ? null : [query.near.latitude, query.near.longitude],
    areaReferences: [...areaReferences].sort((a, b) => a.key.localeCompare(b.key) || a.version - b.version),
    taxonomyReferenceGroups: taxonomyReferenceGroups.map((group) => [...group].sort(
      (a, b) => a.key.localeCompare(b.key) || a.version - b.version,
    )),
    bounds: query.bounds ?? null,
    limit: query.limit,
  })).digest('hex')
  const cursor = decodeCursor(query.cursor, queryFingerprint)
  const bounds = query.bounds
  const result = await pool.query<NameRow>(
    `WITH named AS (
       SELECT document.*, lower(normalize(document.display_name, NFKC)) AS normalized_name
       FROM search.place_documents AS document
     ), ranked AS (
       SELECT document.place_id, document.display_name, document.area_label,
              document.area_key, document.area_version,
              ST_Y(document.location) AS latitude, ST_X(document.location) AS longitude,
              document.primary_taxonomy_key, document.primary_taxonomy_label,
              document.taxonomy_references, document.evidence_status, document.projected_at,
              (CASE
                WHEN $1::text = '' THEN 1
                WHEN normalized_name = $1::text THEN 4
                WHEN starts_with(normalized_name, $1::text) THEN 3
                WHEN strpos(normalized_name, $1::text) > 0 THEN 2
                ELSE similarity(normalized_name, $1::text)
              END)::double precision AS score,
              CASE WHEN $9::double precision IS NULL OR document.location IS NULL THEN NULL
                ELSE ST_Distance(document.location::geography,
                  ST_SetSRID(ST_MakePoint($10::double precision, $9::double precision), 4326)::geography)
              END AS distance_m
       FROM named AS document
       WHERE ($1::text = '' OR normalized_name % $1::text OR strpos(normalized_name, $1::text) > 0)
         AND ($3::double precision IS NULL OR (
           ($3::double precision < $5::double precision AND document.location && ST_MakeEnvelope(
             $3::double precision, $4::double precision, $5::double precision, $6::double precision, 4326
           ))
           OR ($3::double precision > $5::double precision AND (
             document.location && ST_MakeEnvelope($3::double precision, $4::double precision, 180, $6::double precision, 4326)
             OR document.location && ST_MakeEnvelope(-180, $4::double precision, $5::double precision, $6::double precision, 4326)
           ))
         ))
         AND ($7::jsonb = '[]'::jsonb OR EXISTS (
           SELECT 1 FROM jsonb_array_elements($7::jsonb) AS area(reference)
           WHERE document.area_key = area.reference->>'key'
             AND document.area_version = (area.reference->>'version')::bigint
         ))
         AND ($8::jsonb = '[]'::jsonb OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements($8::jsonb) AS required_group(candidates)
           WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(required_group.candidates) AS candidate(reference)
             WHERE document.taxonomy_references @> jsonb_build_array(candidate.reference)
           )
         ))
     )
     SELECT * FROM ranked
     WHERE $13::uuid IS NULL OR score < $11::double precision OR (
       score = $11::double precision AND (
         ($12::double precision IS NOT NULL AND (distance_m IS NULL OR distance_m > $12::double precision))
         OR (distance_m IS NOT DISTINCT FROM $12::double precision AND place_id > $13::uuid)
       )
     )
     ORDER BY score DESC, distance_m ASC NULLS LAST, place_id ASC
     LIMIT $2::int`,
    [normalizedQuery, query.limit + 1, bounds?.west ?? null, bounds?.south ?? null,
      bounds?.east ?? null, bounds?.north ?? null, JSON.stringify(areaReferences),
      JSON.stringify(taxonomyReferenceGroups), query.near?.latitude ?? null, query.near?.longitude ?? null,
      cursor?.score ?? null, cursor?.distance ?? null, cursor?.placeId ?? null],
  )
  const rows = result.rows.slice(0, query.limit)
  const last = rows.at(-1)
  return {
    items: rows.map(toCatalogPlaceSummary),
    ...(result.rows.length <= query.limit || last === undefined ? {} : {
      nextCursor: Buffer.from(JSON.stringify({
        version: 2, queryFingerprint, score: last.score, distance: last.distance_m, placeId: last.place_id,
      } satisfies NameCursor)).toString('base64url'),
    }),
  }
}
