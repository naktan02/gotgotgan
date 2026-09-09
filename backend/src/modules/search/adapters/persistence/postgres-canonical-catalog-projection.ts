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
    const eligibleNames = (await this.pool.query<{ name: string }>(
      `SELECT DISTINCT assertion.text_value AS name
       FROM places.canonical_place_fact_assertion_batches AS batch
       JOIN places.canonical_place_fact_assertions AS assertion ON assertion.batch_id = batch.id
       JOIN places.provider_place_identities AS identity
         ON identity.provider_key = batch.provider_key
        AND identity.external_place_id = batch.external_place_id
       WHERE batch.subject_kind = 'provider-identity'
         AND batch.rights_profile_key = 'basic-place-disclosure.v1'
         AND identity.canonical_place_id = $1::uuid
         AND assertion.fact_kind = 'name'
         AND assertion.text_value IS NOT NULL
       ORDER BY assertion.text_value`,
      [input.placeId],
    )).rows.map((row) => row.name)
    const searchText = [...new Set([input.name, input.address, ...eligibleNames].filter(
      (value): value is string => Boolean(value),
    ))].join(' ').normalize('NFKC').toLocaleLowerCase()
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
          OR search.place_documents.canonical_profile_revision <= EXCLUDED.canonical_profile_revision`,
      [input.placeId, input.revision, input.name, searchText,
        input.location?.latitude ?? null, input.location?.longitude ?? null, input.publishedAt],
    )
    return 'projected'
  }
}
