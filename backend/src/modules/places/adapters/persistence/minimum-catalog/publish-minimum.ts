import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { MinimumPlacePublication } from '../../../domain/minimum-place-facts.js'

const policy = 'import-minimum-place-profile.v1'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function id(seed: string) {
  const value = hash(seed)
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-8${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`
}

/** Identity reuse never overwrites an existing, possibly richer, current profile. */
export async function publishMinimumProfile(client: PoolClient, input: MinimumPlacePublication) {
  const place = (await client.query<{ status: string; current_profile_revision: string | null }>(
    `SELECT status, current_profile_revision FROM places.canonical_places WHERE id = $1::uuid FOR UPDATE`,
    [input.placeId],
  )).rows[0]
  if (place?.status !== 'active') throw new Error('Canonical place is not active')
  const identity = await client.query(
    `SELECT 1 FROM places.provider_place_identities
     WHERE provider_key = $1 AND external_place_id = $2 AND canonical_place_id = $3::uuid FOR SHARE`,
    [input.providerKey, input.externalPlaceId, input.placeId],
  )
  if (identity.rowCount !== 1) throw new Error('Minimum facts do not belong to this place')

  const batchId = id(`${policy}:batch:${input.sourceObservationId}:${input.publicationBasis}`)
  const fingerprint = hash(input)
  const previous = (await client.query<{ fingerprint: string }>(
    'SELECT fingerprint FROM places.canonical_place_fact_assertion_batches WHERE id = $1::uuid', [batchId],
  )).rows[0]
  if (previous !== undefined && previous.fingerprint !== fingerprint) {
    throw new Error('Minimum fact observation was reused with different content')
  }
  const facts = [
    { kind: 'name', text: input.facts.name, location: null },
    ...(input.facts.address === null ? [] : [{ kind: 'formatted-address', text: input.facts.address, location: null }]),
    ...(input.facts.location === null ? [] : [{ kind: 'location', text: null, location: input.facts.location }]),
  ]
  if (previous === undefined) {
    await client.query(
      `INSERT INTO places.canonical_place_fact_assertion_batches (
         id, subject_kind, provider_key, external_place_id, source_observation_id,
         rights_profile_key, asserted_by_kind, asserted_by_reference, observed_at, fingerprint, recorded_at
       ) VALUES ($1::uuid,'provider-identity',$2,$3,$4::uuid,$5,'policy',$6,$7::timestamptz,$8,$9::timestamptz)`,
      [batchId, input.providerKey, input.externalPlaceId, input.sourceObservationId,
        'basic-place-disclosure.v1', `${policy}:${input.publicationBasis}`, input.observedAt, fingerprint, input.recordedAt],
    )
    for (const fact of facts) {
      await client.query(
        `INSERT INTO places.canonical_place_fact_assertions (
           id, batch_id, fact_kind, text_value, location_value, confidence, fingerprint, created_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END,
           0.8,$7,$8::timestamptz)`,
        [id(`${batchId}:${fact.kind}`), batchId, fact.kind, fact.text,
          fact.location?.latitude ?? null, fact.location?.longitude ?? null, hash(fact), input.recordedAt],
      )
    }
  }
  if (place.current_profile_revision !== null) return 'existing' as const
  const operationId = id(`${policy}:profile:${input.placeId}:${batchId}`)
  const rationale = `Initial venue facts; ${input.publicationBasis}; personal fields excluded`
  await client.query(
    `INSERT INTO places.canonical_place_profile_revisions (
       canonical_place_id, revision, operation_id, expected_previous_revision,
       display_name, formatted_address, location, policy_version, rationale,
       published_by_kind, published_by_reference, published_at, fingerprint
     ) VALUES ($1::uuid,1,$2::uuid,NULL,$3,$4,
       CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END,
       $7,$8,'policy',$7,$9::timestamptz,$10)`,
    [input.placeId, operationId, input.facts.name, input.facts.address,
      input.facts.location?.latitude ?? null, input.facts.location?.longitude ?? null,
      policy, rationale, input.recordedAt, fingerprint],
  )
  for (const fact of facts) {
    await client.query(
      `INSERT INTO places.canonical_place_profile_evidence (
         canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
       ) VALUES ($1::uuid,1,$2,$3::uuid,'selected')`,
      [input.placeId, fact.kind, id(`${batchId}:${fact.kind}`)],
    )
  }
  await client.query(
    `INSERT INTO places.canonical_place_profile_operations (
       operation_id, operation_fingerprint, canonical_place_id, expected_previous_revision,
       resulting_revision, outcome, acceptance_status, rationale, result, occurred_at
     ) VALUES ($1::uuid,$2,$3::uuid,NULL,1,'accepted','applied',$4,$5::jsonb,$6::timestamptz)`,
    [operationId, fingerprint, input.placeId, rationale,
      JSON.stringify({ schemaVersion: 'minimum-place-publication.v1', placeId: input.placeId, revision: 1 }), input.recordedAt],
  )
  await client.query('SELECT places.activate_canonical_place_profile($1::uuid,NULL,1)', [input.placeId])
  return 'published' as const
}
