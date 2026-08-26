import type { Pool } from 'pg'

import type {
  FulfillableImportItem,
  ImportedPlaceFulfillmentClaim,
  ImportedPlaceFulfillmentOutcome,
  ImportedPlaceFulfillmentStore,
} from '../../application/ports/imported-place-fulfillment-store.js'
import type { ReviewableImportItem } from '../../application/ports/import-review-store.js'
import {
  ImportLeaseLostError,
  ImportReferenceUnavailableError,
} from '../../domain/imports.js'
import {
  iso,
  refreshBatchProgresses,
} from './postgres-import-common.js'

type FulfillmentClaimRow = Readonly<{
  job_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  provider_place_id: string
  attempt_count: number
  observation_id: string
  candidate_id: string
  decision_id: string
  proposed_place_id: string
  lease_owner: string
  lease_generation: string | number
  lease_expires_at: string | Date
}>

type FulfillmentItemRow = Readonly<{
  item_id: string
  batch_id: string
  member_id: string
  connection_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  provider_place_id: string
  source_list_id: string
  source_item_id: string
  source_list_position: number
  source_position: number
  list_name: string
  display_name: string
  address: string | null
  category_label: string | null
  latitude: number | null
  longitude: number | null
  observation_id: string
  candidate_id: string
  decision_id: string
  proposed_place_id: string
  artifact_reference: string
  payload_checksum: string
  parser_version: string
  acquisition_kind: ReviewableImportItem['capture']['acquisitionKind']
  observed_at: string | Date
}>

function fulfillmentItem(row: FulfillmentItemRow): FulfillableImportItem {
  return {
    itemId: row.item_id,
    batchId: row.batch_id,
    memberId: row.member_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerPlaceId: row.provider_place_id,
    sourceListId: row.source_list_id,
    sourceItemId: row.source_item_id,
    sourceListPosition: row.source_list_position,
    sourcePosition: row.source_position,
    listName: row.list_name,
    name: row.display_name,
    address: row.address,
    categoryLabel: row.category_label,
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    observationId: row.observation_id,
    candidateId: row.candidate_id,
    decisionId: row.decision_id,
    proposedPlaceId: row.proposed_place_id,
    capture: {
      reference: row.artifact_reference,
      checksum: row.payload_checksum,
      parserVersion: row.parser_version,
      acquisitionKind: row.acquisition_kind,
      observedAt: iso(row.observed_at),
    },
  }
}
export class PostgresImportedPlaceFulfillment implements ImportedPlaceFulfillmentStore {
  constructor(private readonly pool: Pool) {}

  async claimNextFulfillment(input: Readonly<{
    workerId: string
    claimedAt: string
    leaseUntil: string
  }>): Promise<ImportedPlaceFulfillmentClaim | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const claimed = await client.query<FulfillmentClaimRow>(
        `WITH candidate AS (
           SELECT job.id
           FROM ingestion.import_place_fulfillment_jobs AS job
           WHERE job.available_at <= $2::timestamptz
             AND (
               job.state IN ('queued', 'waiting')
               OR (job.state = 'leased' AND job.lease_expires_at <= $2::timestamptz)
             )
             AND EXISTS (
               SELECT 1
               FROM ingestion.import_place_fulfillment_intents AS intent
               JOIN ingestion.import_items AS imported ON imported.id = intent.item_id
               JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
               WHERE intent.job_id = job.id AND intent.state = 'pending'
                 AND batch.state <> 'cancelled'
             )
           ORDER BY job.available_at, job.id
           FOR UPDATE OF job SKIP LOCKED
           LIMIT 1
         ), claimed AS (
           UPDATE ingestion.import_place_fulfillment_jobs AS job
           SET state = 'leased', lease_owner = $1,
               lease_generation = job.lease_generation + 1,
               lease_expires_at = $3::timestamptz,
               attempt_count = job.attempt_count + 1,
               updated_at = $2::timestamptz
           FROM candidate
           WHERE job.id = candidate.id
           RETURNING job.*
         )
         SELECT id AS job_id, provider_key, provider_place_id, attempt_count,
                observation_id, candidate_id, decision_id, proposed_place_id,
                lease_owner, lease_generation, lease_expires_at
         FROM claimed`,
        [input.workerId, input.claimedAt, input.leaseUntil],
      )
      const row = claimed.rows[0]
      if (row === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      await client.query(
        `UPDATE ingestion.import_place_fulfillment_attempts
         SET finished_at = $2::timestamptz, outcome_kind = 'failure',
             outcome_code = 'lease-expired', retryable = true
         WHERE job_id = $1::uuid AND finished_at IS NULL`,
        [row.job_id, input.claimedAt],
      )
      await client.query(
        `INSERT INTO ingestion.import_place_fulfillment_attempts (
           job_id, generation, worker_reference, started_at
         ) VALUES ($1::uuid,$2,$3,$4::timestamptz)`,
        [row.job_id, row.lease_generation, input.workerId, input.claimedAt],
      )
      const items = await client.query<FulfillmentItemRow>(
        `SELECT imported.id AS item_id, imported.batch_id, batch.member_id,
                batch.connection_id, batch.provider_key, imported.provider_place_id,
                imported.source_list_id, imported.source_item_id, imported.source_list_position,
                imported.source_position, imported.list_name,
                imported.display_name, imported.address, imported.category_label,
                imported.observation_id, imported.candidate_id, imported.decision_id,
                imported.proposed_place_id, capture.artifact_reference,
                capture.payload_checksum, capture.parser_version, capture.acquisition_kind,
                capture.observed_at,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_Y(imported.location) END AS latitude,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_X(imported.location) END AS longitude
         FROM ingestion.import_place_fulfillment_intents AS intent
         JOIN ingestion.import_items AS imported ON imported.id = intent.item_id
         JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
         JOIN ingestion.import_capture_artifacts AS capture ON capture.id = imported.capture_id
         WHERE intent.job_id = $1::uuid AND intent.state = 'pending'
           AND imported.status = 'enriching' AND batch.state <> 'cancelled'
         ORDER BY imported.id`,
        [row.job_id],
      )
      await client.query('COMMIT')
      return {
        jobId: row.job_id,
        providerKey: row.provider_key,
        providerPlaceId: row.provider_place_id,
        attemptCount: row.attempt_count,
        observationId: row.observation_id,
        candidateId: row.candidate_id,
        decisionId: row.decision_id,
        proposedPlaceId: row.proposed_place_id,
        lease: {
          owner: row.lease_owner,
          generation: Number(row.lease_generation),
          expiresAt: iso(row.lease_expires_at),
        },
        items: items.rows.map(fulfillmentItem),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async renewFulfillmentLease(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    renewedAt: string
    leaseUntil: string
  }>): Promise<boolean> {
    const renewed = await this.pool.query(
      `UPDATE ingestion.import_place_fulfillment_jobs
       SET lease_expires_at = $4::timestamptz, updated_at = $3::timestamptz
       WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
         AND lease_generation = $5 AND lease_expires_at > $3::timestamptz`,
      [input.claim.jobId, input.claim.lease.owner, input.renewedAt,
        input.leaseUntil, input.claim.lease.generation],
    )
    return renewed.rowCount === 1
  }

  async completeFulfillmentItems(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    itemIds: readonly string[]
    canonicalPlaceId: string
    completedAt: string
  }>): Promise<void> {
    const itemIds = [...new Set(input.itemIds)]
    if (itemIds.length === 0) {
      throw new ImportReferenceUnavailableError('Imported place fulfillment items are unavailable.')
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const completed = await client.query<{ batch_id: string }>(
        `WITH requested AS (
           SELECT unnest($4::uuid[]) AS item_id
         ), owned AS (
           SELECT id FROM ingestion.import_place_fulfillment_jobs
           WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
             AND lease_generation = $3
           FOR UPDATE
         ), updated_intent AS (
           UPDATE ingestion.import_place_fulfillment_intents AS intent
           SET state = 'applied', canonical_place_id = $5::uuid,
               updated_at = $6::timestamptz
           FROM owned, requested
           WHERE intent.job_id = owned.id AND intent.item_id = requested.item_id
             AND intent.state = 'pending'
           RETURNING intent.item_id
         )
         UPDATE ingestion.import_items AS imported
         SET status = 'applied', canonical_place_id = $5::uuid,
             updated_at = $6::timestamptz
         FROM updated_intent
         WHERE imported.id = updated_intent.item_id
         RETURNING imported.batch_id`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation,
          itemIds, input.canonicalPlaceId, input.completedAt],
      )
      if (completed.rows.length !== itemIds.length) throw new ImportLeaseLostError()
      await refreshBatchProgresses(
        client,
        [...new Set(completed.rows.map((row) => row.batch_id))],
        input.completedAt,
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async finishFulfillmentJob(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    outcome: ImportedPlaceFulfillmentOutcome
    finishedAt: string
  }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const owned = await client.query(
        `SELECT 1 FROM ingestion.import_place_fulfillment_jobs
         WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
           AND lease_generation = $3
         FOR UPDATE`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation],
      )
      if (owned.rows[0] === undefined) throw new ImportLeaseLostError()
      const batches = await client.query<{ batch_id: string }>(
        `SELECT DISTINCT imported.batch_id
         FROM ingestion.import_place_fulfillment_intents AS intent
         JOIN ingestion.import_items AS imported ON imported.id = intent.item_id
         WHERE intent.job_id = $1::uuid AND intent.state = 'pending'`,
        [input.claim.jobId],
      )
      await client.query(
        `UPDATE ingestion.import_place_fulfillment_attempts
         SET finished_at = $4::timestamptz, outcome_kind = $5,
             outcome_code = $6, retryable = $7
         WHERE job_id = $1::uuid AND generation = $2 AND worker_reference = $3`,
        [input.claim.jobId, input.claim.lease.generation, input.claim.lease.owner,
          input.finishedAt, input.outcome.kind,
          input.outcome.kind === 'failure' ? input.outcome.code : null,
          input.outcome.kind === 'failure' ? input.outcome.retryable : null],
      )
      if (input.outcome.kind === 'completed') {
        const pending = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM ingestion.import_place_fulfillment_intents AS intent
           JOIN ingestion.import_items AS imported ON imported.id = intent.item_id
           JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
           WHERE intent.job_id = $1::uuid AND intent.state = 'pending'
             AND batch.state <> 'cancelled'`,
          [input.claim.jobId],
        )
        const hasPending = pending.rows[0]!.count > 0
        await client.query(
          `UPDATE ingestion.import_place_fulfillment_jobs
           SET state = $4, available_at = $5::timestamptz,
               completed_canonical_place_id = $6::uuid,
               failure_code = NULL, failure_retryable = NULL,
               lease_owner = NULL, lease_expires_at = NULL,
               updated_at = $5::timestamptz
           WHERE id = $1::uuid AND lease_owner = $2 AND lease_generation = $3`,
          [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation,
            hasPending ? 'queued' : 'completed', input.finishedAt,
            input.outcome.canonicalPlaceId],
        )
      } else if (input.outcome.kind === 'needs-review') {
        const detail = input.outcome.detail
        await client.query(
          `UPDATE ingestion.import_items AS imported
           SET display_name = $2, address = $3, category_label = $4,
               location = CASE WHEN $5::double precision IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($6, $5), 4326) END,
               status = 'needs-review', review_reasons = $7::text[],
               updated_at = $8::timestamptz
           FROM ingestion.import_place_fulfillment_intents AS intent
           WHERE intent.item_id = imported.id AND intent.job_id = $1::uuid
             AND intent.state = 'pending'`,
          [input.claim.jobId, detail.name, detail.address, detail.categoryLabel,
            detail.location?.latitude ?? null, detail.location?.longitude ?? null,
            detail.reviewReasons, input.finishedAt],
        )
        await client.query(
          `UPDATE ingestion.import_place_fulfillment_intents
           SET state = 'needs-review', updated_at = $2::timestamptz
           WHERE job_id = $1::uuid AND state = 'pending'`,
          [input.claim.jobId, input.finishedAt],
        )
        await client.query(
          `UPDATE ingestion.import_place_fulfillment_jobs
           SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
               updated_at = $4::timestamptz
           WHERE id = $1::uuid AND lease_owner = $2 AND lease_generation = $3`,
          [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation,
            input.finishedAt],
        )
      } else {
        const retry = input.outcome.retryable && input.outcome.retryAt !== undefined
        if (!retry) {
          await client.query(
            `UPDATE ingestion.import_items AS imported
             SET status = 'failed', updated_at = $2::timestamptz
             FROM ingestion.import_place_fulfillment_intents AS intent
             WHERE intent.item_id = imported.id AND intent.job_id = $1::uuid
               AND intent.state = 'pending'`,
            [input.claim.jobId, input.finishedAt],
          )
          await client.query(
            `UPDATE ingestion.import_place_fulfillment_intents
             SET state = 'failed', updated_at = $2::timestamptz
             WHERE job_id = $1::uuid AND state = 'pending'`,
            [input.claim.jobId, input.finishedAt],
          )
        }
        await client.query(
          `UPDATE ingestion.import_place_fulfillment_jobs
           SET state = $4, available_at = $5::timestamptz,
               failure_code = $6, failure_retryable = $7,
               lease_owner = NULL, lease_expires_at = NULL,
               updated_at = $8::timestamptz
           WHERE id = $1::uuid AND lease_owner = $2 AND lease_generation = $3`,
          [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation,
            retry ? 'waiting' : 'failed', input.outcome.retryAt ?? input.finishedAt,
            input.outcome.code, retry, input.finishedAt],
        )
      }
      const batchIds = batches.rows.map((row) => row.batch_id)
      await refreshBatchProgresses(client, batchIds, input.finishedAt)
      if (input.outcome.kind === 'failure' && batchIds.length > 0) {
        await client.query(
          `UPDATE ingestion.import_batches
           SET failure_code = $2, failure_retryable = $3
           WHERE id = ANY($1::uuid[]) AND state <> 'cancelled'`,
          [batchIds, input.outcome.code, input.outcome.retryable],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
