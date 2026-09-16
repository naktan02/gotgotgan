import type { Pool } from 'pg'

import type { CatalogPlaceSummary } from '../../domain/catalog-home-search.js'
import type {
  LocalPlaceSearchDocument,
  PlaceSearchResult,
  SearchBounds,
} from '../../domain/model.js'

type PlaceDocumentRow = Readonly<{
  place_id: string
  source_version: number
  display_name: string
  area_label: string | null
  area_key: string | null
  area_version: number | string | null
  latitude: number
  longitude: number
  primary_taxonomy_key: string | null
  primary_taxonomy_label: string | null
  taxonomy_keys: string[]
  taxonomy_references: unknown
  evidence_status: PlaceSearchResult['evidenceStatus']
  projected_at: Date | string
}>

export type CatalogSearchRow = Readonly<{
  place_id: string
  display_name: string
  area_label: string | null
  area_key: string | null
  area_version: number | string | null
  latitude: number | null
  longitude: number | null
  primary_taxonomy_key: string | null
  primary_taxonomy_label: string | null
  taxonomy_references: unknown
  evidence_status: CatalogPlaceSummary['evidenceStatus']
  projected_at: Date | string
  score: number
}>

type ProjectedDocumentCountRow = Readonly<{ projected_place_count: number }>

function taxonomyReferences(value: unknown): readonly Readonly<{
  key: string
  version: number
  kind: 'category' | 'attribute'
}>[] {
  if (!Array.isArray(value)) throw new Error('Stored Taxonomy references are invalid.')
  return value.map((reference) => {
    if (
      typeof reference !== 'object' || reference === null ||
      !('key' in reference) || typeof reference.key !== 'string' ||
      !('version' in reference) || typeof reference.version !== 'number' ||
      !('kind' in reference) ||
      (reference.kind !== 'category' && reference.kind !== 'attribute')
    ) throw new Error('Stored Taxonomy references are invalid.')
    return { key: reference.key, version: reference.version, kind: reference.kind }
  })
}

function toPlaceDocument(row: PlaceDocumentRow): LocalPlaceSearchDocument {
  return {
    placeId: row.place_id,
    sourceVersion: row.source_version,
    name: row.display_name,
    areaLabel: row.area_label,
    areaReference: row.area_key === null || row.area_version === null
      ? null
      : { key: row.area_key, version: Number(row.area_version) },
    latitude: row.latitude,
    longitude: row.longitude,
    primaryTaxonomy: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null
      ? null
      : { key: row.primary_taxonomy_key, label: row.primary_taxonomy_label },
    taxonomyKeys: row.taxonomy_keys,
    taxonomyReferences: taxonomyReferences(row.taxonomy_references),
    evidenceStatus: row.evidence_status,
    projectedAt: new Date(row.projected_at).toISOString(),
  }
}

export function toCatalogPlaceSummary(row: CatalogSearchRow): CatalogPlaceSummary {
  const references = taxonomyReferences(row.taxonomy_references)
  const primaryVersion = references.find((reference) => (
    reference.kind === 'category' && reference.key === row.primary_taxonomy_key
  ))?.version ?? null
  return {
    placeId: row.place_id,
    name: row.display_name,
    area: row.area_label === null ? null : {
      label: row.area_label,
      reference: row.area_key === null || row.area_version === null
        ? null
        : { key: row.area_key, version: Number(row.area_version) },
    },
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    primaryTaxonomy: row.primary_taxonomy_key === null || row.primary_taxonomy_label === null
      ? null
      : { key: row.primary_taxonomy_key, version: primaryVersion, label: row.primary_taxonomy_label },
    taxonomyReferences: references,
    evidenceStatus: row.evidence_status,
    projectedAt: new Date(row.projected_at).toISOString(),
  }
}

export class PostgresSearchProjectionReader {
  constructor(private readonly pool: Pool) {}

  async getPlaceDocument(placeId: string): Promise<LocalPlaceSearchDocument | undefined> {
    return (await this.getPlaceDocuments([placeId]))[0]
  }

  async getPlaceDocuments(placeIds: readonly string[]): Promise<readonly LocalPlaceSearchDocument[]> {
    if (placeIds.length === 0) return []
    const result = await this.pool.query<PlaceDocumentRow>(
      `SELECT place_id, source_version, display_name, area_label, area_key, area_version,
              ST_Y(location) AS latitude, ST_X(location) AS longitude,
              primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
              taxonomy_references, evidence_status, projected_at
       FROM search.place_documents
       WHERE place_id = ANY($1::uuid[]) AND location IS NOT NULL`,
      [placeIds],
    )
    return result.rows.map(toPlaceDocument)
  }

  async getCatalogPlaceDocuments(placeIds: readonly string[]): Promise<readonly CatalogPlaceSummary[]> {
    if (placeIds.length === 0) return []
    const result = await this.pool.query<CatalogSearchRow>(
      `SELECT place_id, display_name, area_label, area_key, area_version,
              ST_Y(location) AS latitude, ST_X(location) AS longitude,
              primary_taxonomy_key, primary_taxonomy_label, taxonomy_references,
              evidence_status, projected_at, 0::double precision AS score
       FROM search.place_documents
       WHERE place_id = ANY($1::uuid[])`,
      [placeIds],
    )
    return result.rows.map(toCatalogPlaceSummary)
  }

  async getPlaceDocumentsInBounds(placeIds: readonly string[], bounds: SearchBounds) {
    const requested = [...new Set(placeIds)]
    if (requested.length === 0) return { documents: [], unprojectedPlaceCount: 0 }
    const [documents, coverage] = await Promise.all([
      this.pool.query<PlaceDocumentRow>(
        `SELECT place_id, source_version, display_name, area_label, area_key, area_version,
                ST_Y(location) AS latitude, ST_X(location) AS longitude,
                primary_taxonomy_key, primary_taxonomy_label, taxonomy_keys,
                taxonomy_references, evidence_status, projected_at
         FROM search.place_documents
         WHERE place_id = ANY($1::uuid[])
           AND (
             ($2::double precision < $4::double precision AND location && ST_MakeEnvelope(
               $2::double precision, $3::double precision,
               $4::double precision, $5::double precision, 4326
             ))
             OR ($2::double precision > $4::double precision AND (
               location && ST_MakeEnvelope(
                 $2::double precision, $3::double precision, 180, $5::double precision, 4326
               )
               OR location && ST_MakeEnvelope(
                 -180, $3::double precision, $4::double precision, $5::double precision, 4326
               )
             ))
           )`,
        [requested, bounds.west, bounds.south, bounds.east, bounds.north],
      ),
      this.pool.query<ProjectedDocumentCountRow>(
        `SELECT count(*)::int AS projected_place_count
         FROM search.place_documents
         WHERE place_id = ANY($1::uuid[]) AND location IS NOT NULL`,
        [requested],
      ),
    ])
    return {
      documents: documents.rows.map(toPlaceDocument),
      unprojectedPlaceCount: requested.length - (coverage.rows[0]?.projected_place_count ?? 0),
    }
  }
}
