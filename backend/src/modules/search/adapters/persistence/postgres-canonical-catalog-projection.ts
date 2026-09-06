import type { Pool } from 'pg'

export type CanonicalCatalogProjection = Readonly<{
  placeId: string
  revision: number
  name: string
  address: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  publishedAt: string
  policyVersion: string
  taxonomyReferences: readonly unknown[]
}>

/** Rebuildable search data. Canonical profile revisions, not capture timestamps, order updates. */
export class PostgresCanonicalCatalogProjection {
  constructor(private readonly pool: Pool) {}

  async project(input: CanonicalCatalogProjection): Promise<'projected' | 'skipped'> {
    // This intentionally is not a general rich-profile projector. Never freeze incomplete
    // taxonomy/area/media facts under a newer canonical revision.
    if (input.policyVersion !== 'import-minimum-place-profile.v1' || input.taxonomyReferences.length > 0) return 'skipped'
    if (!Number.isSafeInteger(input.revision) || input.revision < 1 ||
      input.name.trim().length === 0 || input.name.length > 300) throw new Error('Invalid catalog projection')
    const searchText = [input.name, input.address].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase()
    await this.pool.query(
      `INSERT INTO search.place_documents (
         place_id, source_version, canonical_profile_revision, display_name, area_label,
         search_text, location, taxonomy_keys, evidence_status, projected_at, taxonomy_references
       ) VALUES ($1::uuid,$2,$2,$3,NULL,$4,
         CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6,$5),4326) END,
         ARRAY[]::text[],'unverified',$7::timestamptz,'[]'::jsonb)
       ON CONFLICT (place_id) DO UPDATE SET
         source_version = EXCLUDED.source_version,
         canonical_profile_revision = EXCLUDED.canonical_profile_revision,
         display_name = EXCLUDED.display_name, search_text = EXCLUDED.search_text,
         location = EXCLUDED.location, projected_at = EXCLUDED.projected_at
       WHERE search.place_documents.canonical_profile_revision IS NULL
          OR search.place_documents.canonical_profile_revision < EXCLUDED.canonical_profile_revision`,
      [input.placeId, input.revision, input.name, searchText,
        input.location?.latitude ?? null, input.location?.longitude ?? null, input.publishedAt],
    )
    return 'projected'
  }
}
