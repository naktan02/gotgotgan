import type { Pool } from 'pg'

import type { LocalSearchProjectionStore } from '../../application/ports/local-search-projection-store.js'
import type { LocalPlaceDocumentReader } from '../../application/ports/local-place-document-reader.js'
import type {
  PlaceSearchSource,
  SearchSourcePage,
} from '../../application/ports/place-search-source.js'
import {
  InvalidSearchCursorError,
  type LocalPlaceSearchDocument,
  type MemberSearchSignal,
  type SearchBounds,
  type PlaceSearchQuery,
  type PlaceSearchResult,
} from '../../domain/model.js'

type LocalCursor = Readonly<{ score: number; placeId: string }>

type SearchRow = Readonly<{
  place_id: string
  display_name: string
  area_label: string | null
  latitude: number
  longitude: number
  primary_taxonomy_key: string | null
  primary_taxonomy_label: string | null
  taxonomy_keys: string[]
  evidence_status: PlaceSearchResult['evidenceStatus']
  saved: boolean | null
  wanted: boolean | null
  visited: boolean | null
  personal_rating: string | null
  projected_at: string
  score: number
}>

type PlaceDocumentRow = Readonly<{
  place_id: string
  source_version: number
  display_name: string
  area_label: string | null
  latitude: number
  longitude: number
  primary_taxonomy_key: string | null
  primary_taxonomy_label: string | null
  taxonomy_keys: string[]
  evidence_status: PlaceSearchResult['evidenceStatus']
  projected_at: Date | string
}>

type ProjectedDocumentCountRow = Readonly<{ projected_place_count: number }>

function rowToDocument(row: PlaceDocumentRow): LocalPlaceSearchDocument {
  return {
    placeId: row.place_id,
    sourceVersion: row.source_version,
    name: row.display_name,
    areaLabel: row.area_label,
    latitude: row.latitude,
    longitude: row.longitude,
    primaryTaxonomy: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null
      ? null
      : { key: row.primary_taxonomy_key, label: row.primary_taxonomy_label },
    taxonomyKeys: row.taxonomy_keys,
    evidenceStatus: row.evidence_status,
    projectedAt: new Date(row.projected_at).toISOString(),
  }
}

function decodeLocalCursor(value: string | undefined): LocalCursor | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' || parsed === null ||
      !('score' in parsed) || typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) ||
      !('placeId' in parsed) || typeof parsed.placeId !== 'string' || parsed.placeId.length === 0
    ) throw new Error('invalid cursor')
    return parsed as LocalCursor
  } catch {
    throw new InvalidSearchCursorError('Local search cursor is invalid.')
  }
}

function encodeLocalCursor(cursor: LocalCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function rowToResult(row: SearchRow, viewerMemberId: string | undefined): PlaceSearchResult {
  return {
    resultId: `place:${row.place_id}`,
    identity: { kind: 'canonical', placeId: row.place_id },
    source: {
      key: 'local',
      label: '내 장소',
      detailsAvailable: false,
      attributions: [],
    },
    freshness: { kind: 'indexed', observedAt: row.projected_at },
    name: row.display_name,
    areaLabel: row.area_label,
    location: { latitude: row.latitude, longitude: row.longitude },
    primaryTaxonomy: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null
      ? null
      : { key: row.primary_taxonomy_key, label: row.primary_taxonomy_label },
    taxonomyKeys: row.taxonomy_keys,
    evidenceStatus: row.evidence_status,
    ...(viewerMemberId === undefined ? {} : {
      personalState: {
        saved: row.saved ?? false,
        wanted: row.wanted ?? false,
        visited: row.visited ?? false,
        personalRating: row.personal_rating === null ? null : Number(row.personal_rating),
      },
    }),
  }
}

export class PostgresLocalSearch implements
  PlaceSearchSource,
  LocalSearchProjectionStore,
  LocalPlaceDocumentReader {
  readonly sourceKey = 'local'

  constructor(private readonly pool: Pool) {}

  async upsertPlace(document: LocalPlaceSearchDocument): Promise<void> {
    const searchText = [
      document.name,
      document.areaLabel,
      document.primaryTaxonomy?.label,
      ...document.taxonomyKeys,
    ].filter((part): part is string => part !== null && part !== undefined)
      .join(' ').normalize('NFKC').toLocaleLowerCase()

    await this.pool.query(
      `
        INSERT INTO search.place_documents (
          place_id, source_version, display_name, area_label, search_text, location,
          primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
          evidence_status, projected_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326),
          $8, $9, $10::text[], $11, $12::timestamptz
        )
        ON CONFLICT (place_id) DO UPDATE SET
          source_version = EXCLUDED.source_version,
          display_name = EXCLUDED.display_name,
          area_label = EXCLUDED.area_label,
          search_text = EXCLUDED.search_text,
          location = EXCLUDED.location,
          primary_taxonomy_key = EXCLUDED.primary_taxonomy_key,
          primary_taxonomy_label = EXCLUDED.primary_taxonomy_label,
          taxonomy_keys = EXCLUDED.taxonomy_keys,
          evidence_status = EXCLUDED.evidence_status,
          projected_at = EXCLUDED.projected_at
        WHERE search.place_documents.source_version < EXCLUDED.source_version
      `,
      [
        document.placeId, document.sourceVersion, document.name, document.areaLabel,
        searchText, document.latitude, document.longitude,
        document.primaryTaxonomy?.key ?? null, document.primaryTaxonomy?.label ?? null,
        document.taxonomyKeys, document.evidenceStatus, document.projectedAt,
      ],
    )
  }

  async upsertMemberSignal(signal: MemberSearchSignal): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO search.member_place_signals (
          membership_id, place_id, source_version, saved, wanted, visited,
          personal_rating, projected_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz)
        ON CONFLICT (membership_id, place_id) DO UPDATE SET
          source_version = EXCLUDED.source_version,
          saved = EXCLUDED.saved,
          wanted = EXCLUDED.wanted,
          visited = EXCLUDED.visited,
          personal_rating = EXCLUDED.personal_rating,
          projected_at = EXCLUDED.projected_at
        WHERE search.member_place_signals.source_version < EXCLUDED.source_version
      `,
      [
        signal.memberId, signal.placeId, signal.sourceVersion, signal.saved,
        signal.wanted, signal.visited, signal.personalRating, signal.projectedAt,
      ],
    )
  }

  async getPlaceDocument(placeId: string): Promise<LocalPlaceSearchDocument | undefined> {
    return (await this.getPlaceDocuments([placeId]))[0]
  }

  async getPlaceDocuments(placeIds: readonly string[]): Promise<readonly LocalPlaceSearchDocument[]> {
    if (placeIds.length === 0) return []
    const result = await this.pool.query<PlaceDocumentRow>(
      `
        SELECT
          place_id,
          source_version,
          display_name,
          area_label,
          ST_Y(location) AS latitude,
          ST_X(location) AS longitude,
          primary_taxonomy_key,
          primary_taxonomy_label,
          taxonomy_keys,
          evidence_status,
          projected_at
        FROM search.place_documents
        WHERE place_id = ANY($1::uuid[])
      `,
      [placeIds],
    )
    return result.rows.map(rowToDocument)
  }

  async getPlaceDocumentsInBounds(placeIds: readonly string[], bounds: SearchBounds) {
    const requested = [...new Set(placeIds)]
    if (requested.length === 0) return { documents: [], unprojectedPlaceCount: 0 }
    const [documents, coverage] = await Promise.all([
      this.pool.query<PlaceDocumentRow>(
        `
          SELECT
            place_id,
            source_version,
            display_name,
            area_label,
            ST_Y(location) AS latitude,
            ST_X(location) AS longitude,
            primary_taxonomy_key,
            primary_taxonomy_label,
            taxonomy_keys,
            evidence_status,
            projected_at
          FROM search.place_documents
          WHERE place_id = ANY($1::uuid[])
            AND location && ST_MakeEnvelope($2, $3, $4, $5, 4326)
        `,
        [requested, bounds.west, bounds.south, bounds.east, bounds.north],
      ),
      this.pool.query<ProjectedDocumentCountRow>(
        `
          SELECT count(*)::int AS projected_place_count
          FROM search.place_documents
          WHERE place_id = ANY($1::uuid[])
        `,
        [requested],
      ),
    ])
    return {
      documents: documents.rows.map(rowToDocument),
      unprojectedPlaceCount: requested.length - (coverage.rows[0]?.projected_place_count ?? 0),
    }
  }

  async search(query: Omit<PlaceSearchQuery, 'cursor'> & Readonly<{ cursor?: string }>): Promise<SearchSourcePage> {
    const cursor = decodeLocalCursor(query.cursor)
    const normalizedQuery = query.query.normalize('NFKC').trim().toLocaleLowerCase()
    const bounds = query.bounds
    const result = await this.pool.query<SearchRow>(
      `
        WITH ranked AS (
          SELECT
            document.place_id,
            document.display_name,
            document.area_label,
            ST_Y(document.location) AS latitude,
            ST_X(document.location) AS longitude,
            document.primary_taxonomy_key,
            document.primary_taxonomy_label,
            document.taxonomy_keys,
            document.evidence_status,
            signal.saved,
            signal.wanted,
            signal.visited,
            signal.personal_rating,
            document.projected_at,
            CASE
              WHEN $1 = '' THEN 1.0
              ELSE GREATEST(
                similarity(document.search_text, $1),
                CASE WHEN document.search_text LIKE '%' || $1 || '%' THEN 0.5 ELSE 0.0 END
              )
            END::double precision AS score
          FROM search.place_documents AS document
          LEFT JOIN search.member_place_signals AS signal
            ON signal.place_id = document.place_id
           AND signal.membership_id = $3::uuid
          WHERE ($1 = '' OR document.search_text % $1 OR document.search_text LIKE '%' || $1 || '%')
            AND ($4::double precision IS NULL OR document.location && ST_MakeEnvelope($4, $5, $6, $7, 4326))
            AND (cardinality($8::text[]) = 0 OR document.taxonomy_keys && $8::text[])
            AND ($9::boolean IS NULL OR COALESCE(signal.saved, false) = $9)
            AND ($10::boolean IS NULL OR COALESCE(signal.wanted, false) = $10)
            AND ($11::boolean IS NULL OR COALESCE(signal.visited, false) = $11)
            AND ($12::numeric IS NULL OR signal.personal_rating >= $12)
        )
        SELECT * FROM ranked
        WHERE ($13::double precision IS NULL OR score < $13 OR (score = $13 AND place_id > $14::uuid))
        ORDER BY score DESC, place_id ASC
        LIMIT $2
      `,
      [
        normalizedQuery,
        query.limit + 1,
        query.viewerMemberId ?? null,
        bounds?.west ?? null,
        bounds?.south ?? null,
        bounds?.east ?? null,
        bounds?.north ?? null,
        query.filters.taxonomyKeys,
        query.filters.saved ?? null,
        query.filters.wanted ?? null,
        query.filters.visited ?? null,
        query.filters.minimumPersonalRating ?? null,
        cursor?.score ?? null,
        cursor?.placeId ?? null,
      ],
    )

    const hasMore = result.rows.length > query.limit
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows
    const last = rows.at(-1)
    return {
      status: 'complete',
      items: rows.map((row) => rowToResult(row, query.viewerMemberId)),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeLocalCursor({ score: last.score, placeId: last.place_id }),
      } : {}),
    }
  }
}
