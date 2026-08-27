import type { Pool, PoolClient } from 'pg'

import type {
  PlaceIdentityResolutionStore,
} from '../../application/ports/place-identity-resolution-store.js'
import type {
  MatchAssessment,
  NormalizedPlaceIdentityEvidence,
} from '../../domain/model.js'
import { evidenceColumns, evidenceFromRow, iso, type EvidenceRow } from './postgres-resolution-mapping.js'

type ExistingEvidenceRow = Readonly<{
  source_observation_id: string
  observed_at: string | Date
  evidence_fingerprint: string
}>

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function insertEvidence(
  client: PoolClient,
  evidence: NormalizedPlaceIdentityEvidence,
  indexedAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO resolution.place_evidence_index (
       provider_key, external_place_id, source_observation_id, observed_at,
       names, normalized_name_search, address, normalized_address,
       phone, phone_digits, website, website_host, category_label, category_key,
       branch_label, branch_key, floor_label, floor_key, location,
       evidence_fingerprint, indexed_at
     ) VALUES (
       $1,$2,$3::uuid,$4::timestamptz,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,
       CASE WHEN $19::double precision IS NULL THEN NULL ELSE
         ST_SetSRID(ST_MakePoint($20::double precision,$19::double precision),4326)::geography
       END,
       $21,$22::timestamptz
     )`,
    evidenceParameters(evidence, indexedAt),
  )
}

async function updateEvidence(
  client: PoolClient,
  evidence: NormalizedPlaceIdentityEvidence,
  indexedAt: string,
): Promise<void> {
  await client.query(
    `UPDATE resolution.place_evidence_index SET
       source_observation_id = $3::uuid, observed_at = $4::timestamptz,
       names = $5::jsonb, normalized_name_search = $6,
       address = $7, normalized_address = $8, phone = $9, phone_digits = $10,
       website = $11, website_host = $12, category_label = $13, category_key = $14,
       branch_label = $15, branch_key = $16, floor_label = $17, floor_key = $18,
       location = CASE WHEN $19::double precision IS NULL THEN NULL ELSE
         ST_SetSRID(ST_MakePoint($20::double precision,$19::double precision),4326)::geography
       END,
       evidence_fingerprint = $21, indexed_at = $22::timestamptz
     WHERE provider_key = $1 AND external_place_id = $2`,
    evidenceParameters(evidence, indexedAt),
  )
}

function evidenceParameters(evidence: NormalizedPlaceIdentityEvidence, indexedAt: string) {
  return [
    evidence.providerIdentity.providerKey,
    evidence.providerIdentity.externalPlaceId,
    evidence.sourceObservationId,
    evidence.observedAt,
    JSON.stringify(evidence.names),
    evidence.normalizedNameSearch,
    evidence.address,
    evidence.normalizedAddress,
    evidence.phone,
    evidence.phoneDigits,
    evidence.website,
    evidence.websiteHost,
    evidence.category,
    evidence.categoryKey,
    evidence.branch,
    evidence.branchKey,
    evidence.floor,
    evidence.floorKey,
    evidence.location?.latitude ?? null,
    evidence.location?.longitude ?? null,
    evidence.fingerprint,
    indexedAt,
  ]
}

export class PostgresPlaceIdentityResolution implements PlaceIdentityResolutionStore {
  constructor(private readonly pool: Pool) {}

  async indexEvidence(input: Parameters<PlaceIdentityResolutionStore['indexEvidence']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query<ExistingEvidenceRow>(
        `SELECT source_observation_id, observed_at, evidence_fingerprint
         FROM resolution.place_evidence_index
         WHERE provider_key = $1 AND external_place_id = $2
         FOR UPDATE`,
        [input.evidence.providerIdentity.providerKey, input.evidence.providerIdentity.externalPlaceId],
      )
      const row = existing.rows[0]
      if (row === undefined) {
        await insertEvidence(client, input.evidence, input.indexedAt)
        await client.query('COMMIT')
        return 'recorded' as const
      }
      if (row.source_observation_id === input.evidence.sourceObservationId) {
        await client.query('COMMIT')
        return row.evidence_fingerprint === input.evidence.fingerprint
          ? 'replayed' as const
          : 'conflict' as const
      }
      const existingObservedAt = iso(row.observed_at)
      if (
        existingObservedAt > input.evidence.observedAt ||
        (
          existingObservedAt === input.evidence.observedAt &&
          row.source_observation_id.localeCompare(input.evidence.sourceObservationId) > 0
        )
      ) {
        await client.query('COMMIT')
        return 'stale' as const
      }
      await updateEvidence(client, input.evidence, input.indexedAt)
      await client.query('COMMIT')
      return 'recorded' as const
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) return 'conflict' as const
      throw error
    } finally {
      client.release()
    }
  }

  async findCandidates(input: Parameters<PlaceIdentityResolutionStore['findCandidates']>[0]) {
    const evidence = input.evidence
    const result = await this.pool.query<EvidenceRow>(
      `SELECT ${evidenceColumns}
       FROM resolution.place_evidence_index AS candidate
       WHERE candidate.source_observation_id <> $1::uuid
         AND candidate.provider_key <> $2
         AND (
           ($3::text IS NOT NULL AND candidate.phone_digits = $3)
           OR ($4::text IS NOT NULL AND candidate.website_host = $4)
           OR (
             $5::double precision IS NOT NULL AND candidate.location IS NOT NULL AND
             ST_DWithin(
               candidate.location,
               ST_SetSRID(ST_MakePoint($6::double precision,$5::double precision),4326)::geography,
               $7::double precision
             )
           )
           OR (
             candidate.normalized_name_search % $8 AND
             similarity(candidate.normalized_name_search, $8) >= $9::double precision
           )
           OR (
             $10::text IS NOT NULL AND candidate.normalized_address IS NOT NULL AND
             candidate.normalized_address % $10 AND
             similarity(candidate.normalized_address, $10) >= $11::double precision
           )
         )
       ORDER BY
         CASE WHEN $3::text IS NOT NULL AND candidate.phone_digits = $3 THEN 0 ELSE 1 END,
         CASE WHEN $5::double precision IS NOT NULL AND candidate.location IS NOT NULL THEN
           ST_Distance(
             candidate.location,
             ST_SetSRID(ST_MakePoint($6::double precision,$5::double precision),4326)::geography
           )
         ELSE 1000000000 END,
         similarity(candidate.normalized_name_search, $8) DESC,
         candidate.observed_at DESC,
         candidate.source_observation_id
       LIMIT $12`,
      [
        evidence.sourceObservationId,
        evidence.providerIdentity.providerKey,
        evidence.phoneDigits,
        evidence.websiteHost,
        evidence.location?.latitude ?? null,
        evidence.location?.longitude ?? null,
        input.maximumDistanceMeters,
        evidence.normalizedNameSearch,
        input.nameSimilarityThreshold,
        evidence.normalizedAddress,
        input.addressSimilarityThreshold,
        input.maximumCandidates,
      ],
    )
    return result.rows.map(evidenceFromRow)
  }

  async appendAssessment(assessment: MatchAssessment) {
    const inserted = await this.pool.query(
      `INSERT INTO resolution.match_assessments (
         left_observation_id, right_observation_id, left_identity, right_identity,
         policy_version, classification, confidence, features, reasons,
         assessed_at, fingerprint
       ) VALUES (
         $1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5,$6,$7,$8::jsonb,$9::text[],
         $10::timestamptz,$11
       )
       ON CONFLICT (left_observation_id, right_observation_id, policy_version) DO NOTHING
       RETURNING fingerprint`,
      [
        assessment.leftObservationId,
        assessment.rightObservationId,
        JSON.stringify(assessment.leftIdentity),
        JSON.stringify(assessment.rightIdentity),
        assessment.policyVersion,
        assessment.classification,
        assessment.confidence,
        JSON.stringify(assessment.features),
        assessment.reasons,
        assessment.assessedAt,
        assessment.fingerprint,
      ],
    )
    if (inserted.rowCount === 1) return 'recorded' as const
    const existing = await this.pool.query<{ fingerprint: string }>(
      `SELECT fingerprint FROM resolution.match_assessments
       WHERE left_observation_id = $1::uuid AND right_observation_id = $2::uuid
         AND policy_version = $3`,
      [assessment.leftObservationId, assessment.rightObservationId, assessment.policyVersion],
    )
    return existing.rows[0]?.fingerprint === assessment.fingerprint
      ? 'replayed' as const
      : 'conflict' as const
  }
}
