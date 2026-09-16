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
  const place = (await client.query<{
    status: string
    current_profile_revision: string | null
    current_policy_version: string | null
    current_display_name: string | null
    current_formatted_address: string | null
    current_has_location: boolean
    current_published_at: Date | null
  }>(
    `SELECT place.status, place.current_profile_revision,
            profile.policy_version AS current_policy_version,
            profile.display_name AS current_display_name,
            profile.formatted_address AS current_formatted_address,
            profile.location IS NOT NULL AS current_has_location,
            profile.published_at AS current_published_at
     FROM places.canonical_places AS place
     LEFT JOIN places.canonical_place_profile_revisions AS profile
       ON profile.canonical_place_id = place.id
      AND profile.revision = place.current_profile_revision
     WHERE place.id = $1::uuid FOR UPDATE OF place`,
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
  await client.query(
     `INSERT INTO places.place_aliases (
       id, canonical_place_id, alias, language_tag, source_observation_id, created_at
     ) VALUES ($1::uuid,$2::uuid,$3,NULL,$4::uuid,$5::timestamptz)
     ON CONFLICT DO NOTHING`,
    [id(`${policy}:alias:${input.sourceObservationId}`), input.placeId, input.facts.name,
      input.sourceObservationId, input.recordedAt],
  )
  if (place.current_profile_revision !== null) {
    if (place.current_policy_version !== policy) return 'existing' as const
    const fillAddress = place.current_formatted_address === null && input.facts.address !== null
    const fillLocation = !place.current_has_location && input.facts.location !== null
    if (!fillAddress && !fillLocation) return 'existing' as const

    const previousRevision = Number(place.current_profile_revision)
    const revision = previousRevision + 1
    const operationId = id(`${policy}:profile:${input.placeId}:${revision}:${batchId}`)
    const rationale = `Fill missing venue facts; ${input.publicationBasis}; existing selections preserved`
    const publishedAt = new Date(Math.max(
      Date.parse(input.recordedAt),
      (place.current_published_at?.getTime() ?? 0) + 1,
    )).toISOString()
    const profileFingerprint = hash({
      placeId: input.placeId,
      revision,
      previousRevision,
      sourceObservationId: input.sourceObservationId,
      fillAddress,
      fillLocation,
      facts: input.facts,
    })
    await client.query(
      `INSERT INTO places.canonical_place_profile_revisions (
         canonical_place_id, revision, operation_id, expected_previous_revision,
         display_name, display_name_language_tag,
         formatted_address, formatted_address_language_tag, location,
         phone, phone_e164, website_uri, operational_status, opening_hours,
         policy_version, rationale, published_by_kind, published_by_reference,
         published_at, fingerprint
       )
       SELECT canonical_place_id, $2, $3::uuid, $4,
              display_name, display_name_language_tag,
              CASE WHEN $5::boolean THEN $6::text ELSE formatted_address END,
              CASE WHEN $5::boolean THEN NULL ELSE formatted_address_language_tag END,
              CASE WHEN $7::boolean THEN
                ST_SetSRID(ST_MakePoint($9::float8,$8::float8),4326)::geography
                ELSE location END,
              phone, phone_e164, website_uri, operational_status, opening_hours,
              $10, $11, 'policy', $10, $12::timestamptz, $13
       FROM places.canonical_place_profile_revisions
       WHERE canonical_place_id = $1::uuid AND revision = $4`,
      [input.placeId, revision, operationId, previousRevision,
        fillAddress, input.facts.address,
        fillLocation, input.facts.location?.latitude ?? null,
        input.facts.location?.longitude ?? null,
        policy, rationale, publishedAt, profileFingerprint],
    )
    await client.query(
      `INSERT INTO places.canonical_place_profile_evidence (
         canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
       )
       SELECT canonical_place_id, $2, fact_kind, assertion_id, evidence_role
       FROM places.canonical_place_profile_evidence
       WHERE canonical_place_id = $1::uuid AND profile_revision = $3
         AND NOT (($4::boolean AND fact_kind = 'formatted-address')
           OR ($5::boolean AND fact_kind = 'location'))`,
      [input.placeId, revision, previousRevision, fillAddress, fillLocation],
    )
    if (fillAddress) {
      await client.query(
        `INSERT INTO places.canonical_place_profile_evidence (
           canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
         ) VALUES ($1::uuid,$2,'formatted-address',$3::uuid,'selected')`,
        [input.placeId, revision, id(`${batchId}:formatted-address`)],
      )
    }
    if (fillLocation) {
      await client.query(
        `INSERT INTO places.canonical_place_profile_evidence (
           canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
         ) VALUES ($1::uuid,$2,'location',$3::uuid,'selected')`,
        [input.placeId, revision, id(`${batchId}:location`)],
      )
    }
    if (input.facts.name !== place.current_display_name) {
      await client.query(
        `INSERT INTO places.canonical_place_profile_evidence (
           canonical_place_id, profile_revision, fact_kind, assertion_id, evidence_role
         ) VALUES ($1::uuid,$2,'name',$3::uuid,'supporting')`,
        [input.placeId, revision, id(`${batchId}:name`)],
      )
    }
    await client.query(
      `INSERT INTO places.canonical_place_profile_operations (
         operation_id, operation_fingerprint, canonical_place_id, expected_previous_revision,
         resulting_revision, outcome, acceptance_status, rationale, result, occurred_at
       ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,'accepted','applied',$6,$7::jsonb,$8::timestamptz)`,
      [operationId, profileFingerprint, input.placeId, previousRevision, revision, rationale,
        JSON.stringify({ schemaVersion: 'minimum-place-publication.v1', placeId: input.placeId, revision }),
        publishedAt],
    )
    await client.query(
      'SELECT places.activate_canonical_place_profile($1::uuid,$2,$3)',
      [input.placeId, previousRevision, revision],
    )
    return 'published' as const
  }
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
