import type { Pool, PoolClient } from 'pg'
import type { CurrentMinimumPlace } from '../../../domain/minimum-place-facts.js'

type Row = {
  place_id: string; revision: string; display_name: string; formatted_address: string | null
  latitude: number | null; longitude: number | null; published_at: Date
  taxonomy_references: CurrentMinimumPlace['taxonomyReferences']
  policy_version: string
}

export async function readCurrentMinimumPlaces(
  client: Pick<Pool | PoolClient, 'query'>,
  placeIds: readonly string[],
): Promise<readonly CurrentMinimumPlace[]> {
  if (placeIds.length === 0) return []
  if (placeIds.length > 2_000) throw new Error('Canonical profile read exceeds its bound')
  const result = await client.query<Row>(
    `SELECT place.id AS place_id, profile.revision, profile.display_name,
       profile.formatted_address, ST_Y(profile.location::geometry) AS latitude,
       ST_X(profile.location::geometry) AS longitude, profile.published_at, profile.policy_version,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('key', assignment.node_key,
         'version', assignment.node_version, 'role', assignment.assignment_role) ORDER BY assignment.ordinal)
         FROM places.canonical_place_profile_taxonomy AS assignment
         WHERE assignment.canonical_place_id = place.id AND assignment.profile_revision = profile.revision),
         '[]'::jsonb) AS taxonomy_references
     FROM places.canonical_places AS place
     JOIN places.canonical_place_profile_revisions AS profile
       ON profile.canonical_place_id = place.id AND profile.revision = place.current_profile_revision
     WHERE place.id = ANY($1::uuid[]) AND place.status = 'active'`,
    [placeIds],
  )
  return result.rows.map((row) => ({
    placeId: row.place_id, revision: Number(row.revision), name: row.display_name,
    address: row.formatted_address,
    location: row.latitude === null || row.longitude === null
      ? null : { latitude: row.latitude, longitude: row.longitude },
    publishedAt: row.published_at.toISOString(),
    policyVersion: row.policy_version,
    taxonomyReferences: row.taxonomy_references,
  }))
}
