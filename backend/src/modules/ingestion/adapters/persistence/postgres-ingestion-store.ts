import type { Pool, QueryResult } from 'pg'

import type { IngestionStore } from '../../application/ports/ingestion-store.js'
import type {
  IngestionRecord,
  PlaceCandidateRecord,
  ResolutionDecisionRecord,
  SourceObservationRecord,
} from '../../domain/model.js'

function outcome(result: QueryResult, selectedFingerprint: unknown, expectedFingerprint: string) {
  if (result.rowCount === 1) return 'recorded' as const
  return selectedFingerprint === expectedFingerprint ? 'replayed' as const : 'conflict' as const
}

export class PostgresIngestionStore implements IngestionStore {
  constructor(private readonly pool: Pool) {}

  async append(record: IngestionRecord): Promise<'recorded' | 'replayed' | 'conflict'> {
    if (record.kind === 'source-observation') return this.appendObservation(record)
    if (record.kind === 'place-candidate') return this.appendCandidate(record)
    return this.appendDecision(record)
  }

  private async appendObservation(record: SourceObservationRecord) {
    const inserted = await this.pool.query(
      `INSERT INTO ingestion.source_observations (
         id, provider_key, external_place_id, acquisition_kind, payload_checksum, parser_version,
         observed_at, acquired_at, capture_reference, facts, confidence, fingerprint
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.providerKey, record.externalPlaceId, record.acquisitionKind,
        record.payloadChecksum, record.parserVersion, record.observedAt, record.acquiredAt,
        record.captureReference ?? null, record.facts, record.confidence, record.fingerprint],
    )
    if (inserted.rowCount === 1) return 'recorded' as const
    const selected = await this.pool.query('SELECT fingerprint FROM ingestion.source_observations WHERE id = $1', [record.id])
    return outcome(inserted, selected.rows[0]?.fingerprint, record.fingerprint)
  }

  private async appendCandidate(record: PlaceCandidateRecord) {
    const inserted = await this.pool.query(
      `INSERT INTO ingestion.place_candidates (
         id, source_observation_id, parser_version, name, address, location, attributes, fingerprint, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,
         CASE WHEN $6::double precision IS NULL THEN NULL ELSE
           ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography END,
         $8,$9,$10
       ) ON CONFLICT (id) DO NOTHING`,
      [record.id, record.sourceObservationId, record.parserVersion, record.name, record.address ?? null,
        record.location?.longitude ?? null, record.location?.latitude ?? null,
        record.attributes, record.fingerprint, record.createdAt],
    )
    if (inserted.rowCount === 1) return 'recorded' as const
    const selected = await this.pool.query('SELECT fingerprint FROM ingestion.place_candidates WHERE id = $1', [record.id])
    return outcome(inserted, selected.rows[0]?.fingerprint, record.fingerprint)
  }

  private async appendDecision(record: ResolutionDecisionRecord) {
    const inserted = await this.pool.query(
      `INSERT INTO ingestion.resolution_decisions (
         id, candidate_id, decision_kind, decision,
         decided_by_kind, decided_by_reference, evidence_observation_ids, rationale, fingerprint, decided_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.candidateId ?? null, record.decision.kind, record.decision,
        record.decidedBy.kind, record.decidedBy.reference, record.evidenceObservationIds,
        record.rationale, record.fingerprint, record.decidedAt],
    )
    if (inserted.rowCount === 1) return 'recorded' as const
    const selected = await this.pool.query('SELECT fingerprint FROM ingestion.resolution_decisions WHERE id = $1', [record.id])
    return outcome(inserted, selected.rows[0]?.fingerprint, record.fingerprint)
  }
}
