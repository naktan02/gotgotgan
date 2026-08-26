import type { Pool, PoolClient } from 'pg'

import type { ImportManagementStore } from '../../application/ports/import-management-store.js'
import type {
  ExpiredImportCapture,
  ImportCaptureRetentionStore,
} from '../../application/ports/import-capture-retention-store.js'
import type {
  ImportReviewResult,
  ImportReviewStore,
  ReviewableImportItem,
} from '../../application/ports/import-review-store.js'
import type { ImportRequestCommand, ImportRequestStore } from '../../application/ports/import-request-store.js'
import type {
  ImportAttemptOutcome,
  ImportClaim,
  ImportWorkerStore,
} from '../../application/ports/import-worker-store.js'
import type {
  ImportedPlaceFulfillmentClaim,
  ImportedPlaceFulfillmentOutcome,
  ImportedPlaceFulfillmentStore,
} from '../../application/ports/imported-place-fulfillment-store.js'
import type {
  ProviderConnectionRegistration,
  ProviderConnectionStore,
} from '../../application/ports/provider-connection-store.js'
import {
  ImportLeaseLostError,
  ImportReferenceUnavailableError,
  type ImportBatchState,
  type ImportFailureCode,
  type PlaceImportBatch,
  type PlaceImportBatchDetail,
  type PlaceImportItem,
  type ProviderConnectionProjection,
} from '../../domain/imports.js'

type BatchRow = Readonly<{
  id: string
  connection_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  state: ImportBatchState
  failure_code: ImportFailureCode | null
  failure_retryable: boolean | null
  discovered_count: number
  ready_count: number
  review_required_count: number
  enriching_count: number
  applied_count: number
  skipped_count: number
  failed_count: number
  created_at: string | Date
  updated_at: string | Date
}>

type ItemRow = Readonly<{
  id: string
  batch_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  provider_place_id: string | null
  list_name: string
  display_name: string
  address: string | null
  category_label: string | null
  latitude: number | null
  longitude: number | null
  status: PlaceImportItem['status']
  review_reasons: readonly string[]
  canonical_place_id: string | null
}>

type ClaimRow = Readonly<{
  job_id: string
  batch_id: string
  member_id: string
  connection_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  secret_reference: string | null
  profile_reference: string | null
  attempt_count: number
  cursor: string | null
  lease_owner: string
  lease_generation: string | number
  lease_expires_at: string | Date
  cancellation_requested_at: string | Date | null
}>

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

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function batch(row: BatchRow): PlaceImportBatch {
  return {
    batchId: row.id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    state: row.state,
    progress: {
      discovered: row.discovered_count,
      ready: row.ready_count,
      reviewRequired: row.review_required_count,
      enriching: row.enriching_count,
      applied: row.applied_count,
      skipped: row.skipped_count,
      failed: row.failed_count,
    },
    ...(row.failure_code === null || row.failure_retryable === null
      ? {}
      : { failure: { code: row.failure_code, retryable: row.failure_retryable } }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

function item(row: ItemRow): PlaceImportItem {
  return {
    itemId: row.id,
    batchId: row.batch_id,
    providerKey: row.provider_key,
    ...(row.provider_place_id === null ? {} : { providerPlaceId: row.provider_place_id }),
    listName: row.list_name,
    name: row.display_name,
    address: row.address,
    categoryLabel: row.category_label,
    location: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    status: row.status,
    reviewReasons: row.review_reasons,
    ...(row.canonical_place_id === null ? {} : { canonicalPlaceId: row.canonical_place_id }),
  }
}

function fulfillmentItem(row: FulfillmentItemRow): ReviewableImportItem {
  return {
    itemId: row.item_id,
    batchId: row.batch_id,
    memberId: row.member_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerPlaceId: row.provider_place_id,
    sourceListId: row.source_list_id,
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

async function selectBatch(
  client: Pool | PoolClient,
  batchId: string,
  memberId?: string,
): Promise<PlaceImportBatch | undefined> {
  const selected = await client.query<BatchRow>(
    `SELECT * FROM ingestion.import_batches
     WHERE id = $1::uuid ${memberId === undefined ? '' : 'AND member_id = $2::uuid'}`,
    memberId === undefined ? [batchId] : [batchId, memberId],
  )
  const row = selected.rows[0]
  return row === undefined ? undefined : batch(row)
}

async function refreshBatchProgress(
  client: Pool | PoolClient,
  batchId: string,
  updatedAt: string,
): Promise<void> {
  await client.query(
    `WITH counts AS (
       SELECT count(*)::int AS discovered,
              count(*) FILTER (WHERE status = 'ready')::int AS ready,
              count(*) FILTER (WHERE status = 'needs-review')::int AS review_required,
              count(*) FILTER (WHERE status = 'enriching')::int AS enriching,
              count(*) FILTER (WHERE status = 'applied')::int AS applied,
              count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM ingestion.import_items WHERE batch_id = $1::uuid
     )
     UPDATE ingestion.import_batches AS batch
     SET state = CASE
           WHEN counts.enriching > 0 THEN 'enriching'
           WHEN counts.ready + counts.review_required > 0 THEN 'needs-review'
           WHEN counts.discovered > 0 AND counts.failed = counts.discovered THEN 'failed'
           WHEN counts.failed > 0 THEN 'partial'
           ELSE 'completed'
         END,
         discovered_count = counts.discovered,
         ready_count = counts.ready,
         review_required_count = counts.review_required,
         enriching_count = counts.enriching,
         applied_count = counts.applied,
         skipped_count = counts.skipped,
         failed_count = counts.failed,
         updated_at = $2::timestamptz
     FROM counts
     WHERE batch.id = $1::uuid AND batch.state <> 'cancelled'`,
    [batchId, updatedAt],
  )
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export class PostgresPlaceImports implements
  ImportRequestStore,
  ImportWorkerStore,
  ProviderConnectionStore,
  ImportManagementStore,
  ImportReviewStore,
  ImportCaptureRetentionStore,
  ImportedPlaceFulfillmentStore {
  constructor(private readonly pool: Pool) {}

  async registerConnection(command: ProviderConnectionRegistration) {
    const inserted = await this.pool.query(
      `INSERT INTO ingestion.provider_connections (
         id, member_id, provider_key, label, status, secret_reference, profile_reference,
         last_verified_at, created_at, updated_at
       ) VALUES ($1::uuid,$2::uuid,$3,$4,'ready',$5,$6,$7::timestamptz,$7::timestamptz,$7::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [command.connectionId, command.memberId, command.providerKey, command.label,
        command.secretReference ?? null, command.profileReference ?? null, command.registeredAt],
    )
    if (inserted.rowCount === 1) return 'registered' as const
    const existing = await this.pool.query<{
      member_id: string
      provider_key: string
      label: string
      secret_reference: string | null
      profile_reference: string | null
    }>(
      `SELECT member_id, provider_key, label, secret_reference, profile_reference
       FROM ingestion.provider_connections WHERE id = $1::uuid`,
      [command.connectionId],
    )
    const row = existing.rows[0]
    return row !== undefined &&
      row.member_id === command.memberId &&
      row.provider_key === command.providerKey &&
      row.label === command.label &&
      row.secret_reference === (command.secretReference ?? null) &&
      row.profile_reference === (command.profileReference ?? null)
      ? 'replayed' as const
      : 'conflict' as const
  }

  async listConnections(memberId: string): Promise<readonly ProviderConnectionProjection[]> {
    const result = await this.pool.query<{
      id: string
      provider_key: 'naver' | 'kakao' | 'google'
      label: string
      status: 'ready' | 'action-required' | 'revoked'
      last_verified_at: string | Date | null
    }>(
      `SELECT id, provider_key, label, status, last_verified_at
       FROM ingestion.provider_connections
       WHERE member_id = $1::uuid
       ORDER BY created_at, id`,
      [memberId],
    )
    return result.rows.map((row) => ({
      connectionId: row.id,
      providerKey: row.provider_key,
      label: row.label,
      status: row.status,
      lastVerifiedAt: row.last_verified_at === null ? null : iso(row.last_verified_at),
    }))
  }

  async findExpired(input: Readonly<{
    expiredAt: string
    limit: number
  }>): Promise<readonly ExpiredImportCapture[]> {
    const selected = await this.pool.query<{
      id: string
      batch_id: string
      provider_key: 'naver' | 'kakao' | 'google'
      artifact_reference: string
    }>(
      `SELECT capture.id, capture.batch_id, batch.provider_key, capture.artifact_reference
       FROM ingestion.import_capture_artifacts AS capture
       JOIN ingestion.import_batches AS batch ON batch.id = capture.batch_id
       WHERE capture.retained_until <= $1::timestamptz AND capture.deleted_at IS NULL
       ORDER BY capture.retained_until, capture.id
       LIMIT $2`,
      [input.expiredAt, input.limit],
    )
    return selected.rows.map((row) => ({
      captureId: row.id,
      batchId: row.batch_id,
      providerKey: row.provider_key,
      artifactReference: row.artifact_reference,
    }))
  }

  async markDeleted(input: Readonly<{
    captureId: string
    deletedAt: string
  }>): Promise<'marked' | 'already-deleted'> {
    const updated = await this.pool.query(
      `UPDATE ingestion.import_capture_artifacts
       SET deleted_at = $2::timestamptz
       WHERE id = $1::uuid AND deleted_at IS NULL AND retained_until <= $2::timestamptz`,
      [input.captureId, input.deletedAt],
    )
    return updated.rowCount === 1 ? 'marked' : 'already-deleted'
  }

  async requestImport(command: ImportRequestCommand) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const connection = await client.query<{
        provider_key: 'naver' | 'kakao' | 'google'
      }>(
        `SELECT provider_key FROM ingestion.provider_connections
         WHERE id = $1::uuid AND member_id = $2::uuid AND status = 'ready'
         FOR SHARE`,
        [command.connectionId, command.memberId],
      )
      if (connection.rows[0] === undefined) {
        await client.query('ROLLBACK')
        return { status: 'connection-unavailable' as const }
      }
      const inserted = await client.query<BatchRow>(
        `INSERT INTO ingestion.import_batches (
           id, member_id, connection_id, provider_key, idempotency_key, request_fingerprint,
           state, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,'queued',$7::timestamptz,$7::timestamptz)
         ON CONFLICT (member_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [command.batchId, command.memberId, command.connectionId, connection.rows[0].provider_key,
          command.idempotencyKey, command.requestFingerprint, command.requestedAt],
      )
      if (inserted.rows[0] === undefined) {
        const prior = await client.query<BatchRow & { request_fingerprint: string }>(
          `SELECT * FROM ingestion.import_batches
           WHERE member_id = $1::uuid AND idempotency_key = $2::uuid`,
          [command.memberId, command.idempotencyKey],
        )
        await client.query('COMMIT')
        const row = prior.rows[0]!
        return row.request_fingerprint === command.requestFingerprint
          ? { status: 'replayed' as const, batch: batch(row) }
          : { status: 'conflict' as const }
      }
      await client.query(
        `INSERT INTO ingestion.import_jobs (
           id, batch_id, state, available_at, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'queued',$3::timestamptz,$3::timestamptz,$3::timestamptz)`,
        [command.jobId, command.batchId, command.requestedAt],
      )
      await client.query('COMMIT')
      return { status: 'created' as const, batch: batch(inserted.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) return { status: 'conflict' as const }
      throw error
    } finally {
      client.release()
    }
  }

  async claimNext(input: Readonly<{ workerId: string; claimedAt: string; leaseUntil: string }>) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const claimed = await client.query<ClaimRow>(
        `WITH candidate AS (
           SELECT job.id
           FROM ingestion.import_jobs AS job
           JOIN ingestion.import_batches AS batch ON batch.id = job.batch_id
           WHERE batch.cancellation_requested_at IS NULL
             AND job.available_at <= $2::timestamptz
             AND (
               job.state IN ('queued', 'waiting')
               OR (job.state = 'leased' AND job.lease_expires_at <= $2::timestamptz)
             )
           ORDER BY job.available_at, job.id
           FOR UPDATE OF job SKIP LOCKED
           LIMIT 1
         ), claimed AS (
           UPDATE ingestion.import_jobs AS job
           SET state = 'leased', lease_owner = $1, lease_generation = job.lease_generation + 1,
               lease_expires_at = $3::timestamptz, attempt_count = job.attempt_count + 1,
               updated_at = $2::timestamptz
           FROM candidate
           WHERE job.id = candidate.id
           RETURNING job.*
         )
         SELECT claimed.id AS job_id, claimed.batch_id, batch.member_id,
                connection.id AS connection_id, connection.provider_key,
                connection.secret_reference, connection.profile_reference,
                claimed.attempt_count, claimed.cursor, claimed.lease_owner,
                claimed.lease_generation, claimed.lease_expires_at,
                batch.cancellation_requested_at
         FROM claimed
         JOIN ingestion.import_batches AS batch ON batch.id = claimed.batch_id
         JOIN ingestion.provider_connections AS connection ON connection.id = batch.connection_id`,
        [input.workerId, input.claimedAt, input.leaseUntil],
      )
      const row = claimed.rows[0]
      if (row === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      await client.query(
        `UPDATE ingestion.import_attempts
         SET finished_at = $2::timestamptz, outcome_kind = 'failure',
             outcome_code = 'lease-expired', retryable = true
         WHERE job_id = $1::uuid AND finished_at IS NULL`,
        [row.job_id, input.claimedAt],
      )
      await client.query(
        `INSERT INTO ingestion.import_attempts (
           job_id, generation, worker_reference, started_at
         ) VALUES ($1::uuid,$2,$3,$4::timestamptz)`,
        [row.job_id, row.lease_generation, input.workerId, input.claimedAt],
      )
      await client.query(
        `UPDATE ingestion.import_batches
         SET state = 'running', updated_at = $2::timestamptz
         WHERE id = $1::uuid`,
        [row.batch_id, input.claimedAt],
      )
      await client.query('COMMIT')
      return this.claim(row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async renewLease(input: Readonly<{ claim: ImportClaim; renewedAt: string; leaseUntil: string }>) {
    const result = await this.pool.query(
      `UPDATE ingestion.import_jobs AS job
       SET lease_expires_at = $4::timestamptz, updated_at = $3::timestamptz
       FROM ingestion.import_batches AS batch
       WHERE job.id = $1::uuid AND job.batch_id = batch.id
         AND job.state = 'leased' AND job.lease_owner = $2
         AND job.lease_generation = $5 AND job.lease_expires_at > $3::timestamptz
         AND batch.cancellation_requested_at IS NULL`,
      [input.claim.jobId, input.claim.lease.owner, input.renewedAt,
        input.leaseUntil, input.claim.lease.generation],
    )
    return result.rowCount === 1
  }

  async recordPage(input: Parameters<ImportWorkerStore['recordPage']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const owned = await client.query<{ cancellation_requested_at: string | Date | null }>(
        `SELECT batch.cancellation_requested_at
         FROM ingestion.import_jobs AS job
         JOIN ingestion.import_batches AS batch ON batch.id = job.batch_id
         WHERE job.id = $1::uuid AND job.state = 'leased' AND job.lease_owner = $2
           AND job.lease_generation = $3
         FOR UPDATE OF job, batch`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation],
      )
      const ownership = owned.rows[0]
      if (ownership === undefined) throw new ImportLeaseLostError()
      if (ownership.cancellation_requested_at !== null) {
        await this.finishOwnedAttempt(client, input.claim, { kind: 'cancelled' }, input.recordedAt)
        await client.query('COMMIT')
        return { status: 'cancelled' as const }
      }
      await client.query(
        `INSERT INTO ingestion.import_capture_artifacts (
           id, batch_id, artifact_reference, payload_checksum, parser_version,
           acquisition_kind, observed_at, retained_until, created_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [input.capture.artifactId, input.claim.batchId, input.capture.reference,
          input.capture.checksum, input.capture.parserVersion, input.capture.acquisitionKind,
          input.capture.observedAt, input.capture.retentionUntil, input.recordedAt],
      )
      for (const imported of input.items) {
        const insertedItem = await client.query<{ id: string }>(
          `INSERT INTO ingestion.import_items (
             id, batch_id, capture_id, source_item_key, provider_place_id,
             source_list_id, source_list_position, source_position, list_name,
             display_name, address, category_label, location, status, review_reasons,
             observation_id, candidate_id, decision_id, proposed_place_id, created_at, updated_at
           ) VALUES (
             $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $13::double precision IS NULL THEN NULL
               ELSE ST_SetSRID(ST_MakePoint($14, $13), 4326) END,
             $15,$16::text[],$17::uuid,$18::uuid,$19::uuid,$20::uuid,
             $21::timestamptz,$21::timestamptz
            ) ON CONFLICT (batch_id, source_item_key) DO NOTHING
            RETURNING id`,
          [imported.itemId, input.claim.batchId, input.capture.artifactId,
            imported.sourceItemKey, imported.providerPlaceId ?? null,
            imported.sourceListId, imported.sourceListPosition,
            imported.sourcePosition, imported.listName,
            imported.name, imported.address, imported.categoryLabel,
            imported.location?.latitude ?? null, imported.location?.longitude ?? null,
            imported.fulfillment === undefined ? 'needs-review' : 'enriching',
            imported.reviewReasons, imported.observationId, imported.candidateId,
            imported.decisionId, imported.proposedPlaceId, input.recordedAt],
        )
        if (insertedItem.rows[0] !== undefined && imported.fulfillment !== undefined) {
          const fulfillment = imported.fulfillment
          const job = await client.query<{ id: string }>(
            `INSERT INTO ingestion.import_place_fulfillment_jobs AS job (
               id, provider_key, provider_place_id, state, available_at,
               observation_id, candidate_id, decision_id, proposed_place_id,
               created_at, updated_at
             ) VALUES (
               $1::uuid,$2,$3,'queued',$4::timestamptz,
               $5::uuid,$6::uuid,$7::uuid,$8::uuid,$4::timestamptz,$4::timestamptz
             )
             ON CONFLICT (provider_key, provider_place_id) DO UPDATE
             SET state = CASE
                   WHEN job.state IN ('completed', 'failed') THEN 'queued'
                   ELSE job.state
                 END,
                 available_at = CASE
                   WHEN job.state IN ('completed', 'failed') THEN EXCLUDED.available_at
                   ELSE job.available_at
                 END,
                 attempt_count = CASE
                   WHEN job.state IN ('completed', 'failed') THEN 0
                   ELSE job.attempt_count
                 END,
                 failure_code = CASE
                   WHEN job.state IN ('completed', 'failed') THEN NULL
                   ELSE job.failure_code
                 END,
                 failure_retryable = CASE
                   WHEN job.state IN ('completed', 'failed') THEN NULL
                   ELSE job.failure_retryable
                 END,
                 updated_at = EXCLUDED.updated_at
             RETURNING job.id`,
            [fulfillment.jobId, input.claim.connection.providerKey, imported.providerPlaceId,
              input.recordedAt, fulfillment.observationId, fulfillment.candidateId,
              fulfillment.decisionId, fulfillment.proposedPlaceId],
          )
          await client.query(
            `INSERT INTO ingestion.import_place_fulfillment_intents (
               item_id, job_id, state, created_at, updated_at
             ) VALUES ($1::uuid,$2::uuid,'pending',$3::timestamptz,$3::timestamptz)
             ON CONFLICT (item_id) DO NOTHING`,
            [insertedItem.rows[0].id, job.rows[0]!.id, input.recordedAt],
          )
        }
      }
      const counts = await client.query<{
        discovered: number
        ready: number
        review_required: number
        enriching: number
        applied: number
        skipped: number
        failed: number
      }>(
        `SELECT count(*)::int AS discovered,
                count(*) FILTER (WHERE status = 'ready')::int AS ready,
                count(*) FILTER (WHERE status = 'needs-review')::int AS review_required,
                count(*) FILTER (WHERE status = 'enriching')::int AS enriching,
                count(*) FILTER (WHERE status = 'applied')::int AS applied,
                count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
                count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM ingestion.import_items WHERE batch_id = $1::uuid`,
        [input.claim.batchId],
      )
      const progress = counts.rows[0]!
      const state: 'partial' | 'completed' | 'enriching' | 'needs-review' = input.nextCursor === null
        ? (progress.discovered === 0
            ? 'completed'
            : progress.enriching > 0
              ? 'enriching'
              : 'needs-review')
        : 'partial'
      await client.query(
        `UPDATE ingestion.import_batches
         SET state = $2, failure_code = NULL, failure_retryable = NULL,
              discovered_count = $3, ready_count = $4, review_required_count = $5,
              enriching_count = $6, applied_count = $7, skipped_count = $8, failed_count = $9,
              updated_at = $10::timestamptz
         WHERE id = $1::uuid`,
          [input.claim.batchId, state, progress.discovered, progress.ready,
           progress.review_required, progress.enriching, progress.applied, progress.skipped,
           progress.failed, input.recordedAt],
      )
      await client.query(
        `UPDATE ingestion.import_jobs
         SET state = $2, cursor = $3, available_at = $4::timestamptz,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = $4::timestamptz
         WHERE id = $1::uuid`,
        [input.claim.jobId, input.nextCursor === null ? 'completed' : 'queued',
          input.nextCursor, input.recordedAt],
      )
      await client.query(
        `UPDATE ingestion.import_attempts
         SET finished_at = $4::timestamptz, outcome_kind = 'page',
             outcome_code = NULL, retryable = NULL
         WHERE job_id = $1::uuid AND generation = $2 AND worker_reference = $3`,
        [input.claim.jobId, input.claim.lease.generation, input.claim.lease.owner, input.recordedAt],
      )
      await client.query('COMMIT')
      return {
        status: input.nextCursor === null
          ? (state === 'partial' ? 'queued' as const : state)
          : 'queued' as const,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async finishAttempt(input: Parameters<ImportWorkerStore['finishAttempt']>[0]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const owned = await client.query(
        `SELECT 1 FROM ingestion.import_jobs
         WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2 AND lease_generation = $3
         FOR UPDATE`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation],
      )
      if (owned.rows[0] === undefined) throw new ImportLeaseLostError()
      await this.finishOwnedAttempt(client, input.claim, input.outcome, input.finishedAt)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async getImport(memberId: string, batchId: string): Promise<PlaceImportBatchDetail | undefined> {
    const selectedBatch = await selectBatch(this.pool, batchId, memberId)
    if (selectedBatch === undefined) return undefined
    const items = await this.pool.query<ItemRow>(
      `SELECT imported.id, imported.batch_id, batch.provider_key, imported.provider_place_id,
              imported.list_name, imported.display_name, imported.address,
              imported.category_label, imported.status, imported.review_reasons,
              imported.canonical_place_id,
              CASE WHEN imported.location IS NULL THEN NULL ELSE ST_Y(imported.location) END AS latitude,
              CASE WHEN imported.location IS NULL THEN NULL ELSE ST_X(imported.location) END AS longitude
       FROM ingestion.import_items AS imported
       JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
       WHERE imported.batch_id = $1::uuid
       ORDER BY imported.id
       LIMIT 200`,
      [batchId],
    )
    return { batch: selectedBatch, items: items.rows.map(item) }
  }

  async cancelImport(memberId: string, batchId: string, cancelledAt: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const changed = await client.query(
        `UPDATE ingestion.import_batches
         SET cancellation_requested_at = COALESCE(cancellation_requested_at, $3::timestamptz),
             state = 'cancelled', updated_at = $3::timestamptz
         WHERE id = $1::uuid AND member_id = $2::uuid
           AND state NOT IN ('completed', 'cancelled')
         RETURNING id`,
        [batchId, memberId, cancelledAt],
      )
      if (changed.rows[0] === undefined) {
        const existing = await selectBatch(client, batchId, memberId)
        await client.query('COMMIT')
        return existing
      }
      await client.query(
        `UPDATE ingestion.import_jobs
         SET state = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
             updated_at = $2::timestamptz
         WHERE batch_id = $1::uuid AND state <> 'leased'`,
        [batchId, cancelledAt],
      )
      await client.query(
        `UPDATE ingestion.import_place_fulfillment_intents AS intent
         SET state = 'cancelled', updated_at = $2::timestamptz
         FROM ingestion.import_items AS imported
         WHERE intent.item_id = imported.id AND imported.batch_id = $1::uuid
           AND intent.state = 'pending'`,
        [batchId, cancelledAt],
      )
      const result = await selectBatch(client, batchId, memberId)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async resumeImport(memberId: string, batchId: string, resumedAt: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const changed = await client.query(
        `UPDATE ingestion.import_batches AS batch
         SET state = 'queued', failure_code = NULL, failure_retryable = NULL,
             cancellation_requested_at = NULL, updated_at = $3::timestamptz
         FROM ingestion.provider_connections AS connection
         WHERE batch.id = $1::uuid AND batch.member_id = $2::uuid
           AND batch.connection_id = connection.id AND connection.status = 'ready'
           AND batch.state IN ('needs-user-action', 'failed', 'cancelled', 'partial')
         RETURNING batch.id`,
        [batchId, memberId, resumedAt],
      )
      if (changed.rows[0] !== undefined) {
        await client.query(
          `UPDATE ingestion.import_jobs
           SET state = 'queued', available_at = $2::timestamptz,
               lease_owner = NULL, lease_expires_at = NULL, updated_at = $2::timestamptz
           WHERE batch_id = $1::uuid AND state <> 'leased'`,
          [batchId, resumedAt],
        )
        await client.query(
          `WITH restored AS (
             UPDATE ingestion.import_place_fulfillment_intents AS intent
             SET state = 'pending', updated_at = $2::timestamptz
             FROM ingestion.import_items AS imported
             WHERE intent.item_id = imported.id AND imported.batch_id = $1::uuid
               AND intent.state = 'cancelled'
             RETURNING intent.job_id
           )
           UPDATE ingestion.import_place_fulfillment_jobs AS job
           SET state = CASE WHEN job.state = 'leased' THEN job.state ELSE 'queued' END,
               available_at = $2::timestamptz,
               failure_code = NULL, failure_retryable = NULL,
               updated_at = $2::timestamptz
           WHERE job.id IN (SELECT job_id FROM restored)`,
          [batchId, resumedAt],
        )
      }
      const result = await selectBatch(client, batchId, memberId)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async beginReview(input: Parameters<ImportReviewStore['beginReview']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<{
        item_id: string
        batch_id: string
        member_id: string
        connection_id: string
        provider_key: 'naver' | 'kakao' | 'google'
        provider_place_id: string | null
        source_list_id: string
        source_list_position: number
        source_position: number
        list_name: string
        display_name: string
        address: string | null
        category_label: string | null
        latitude: number | null
        longitude: number | null
        item_status: PlaceImportItem['status']
        observation_id: string
        candidate_id: string
        decision_id: string
        proposed_place_id: string
        artifact_reference: string
        payload_checksum: string
        parser_version: string
        acquisition_kind: ReviewableImportItem['capture']['acquisitionKind']
        observed_at: string | Date
      }>(
        `SELECT imported.id AS item_id, imported.batch_id, batch.member_id,
                batch.connection_id, batch.provider_key, imported.provider_place_id,
                imported.source_list_id, imported.source_list_position,
                imported.source_position,
                imported.list_name, imported.display_name,
                imported.address, imported.category_label, imported.status AS item_status,
                imported.observation_id, imported.candidate_id, imported.decision_id,
                imported.proposed_place_id, capture.artifact_reference,
                capture.payload_checksum, capture.parser_version, capture.acquisition_kind,
                capture.observed_at,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_Y(imported.location) END AS latitude,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_X(imported.location) END AS longitude
         FROM ingestion.import_items AS imported
         JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
         JOIN ingestion.import_capture_artifacts AS capture ON capture.id = imported.capture_id
         WHERE imported.id = $1::uuid AND batch.member_id = $2::uuid
         FOR UPDATE OF imported`,
        [input.itemId, input.memberId],
      )
      const row = selected.rows[0]
      if (row === undefined) {
        await client.query('ROLLBACK')
        return { status: 'not-found' as const }
      }
      const receipt = await client.query<{
        command_id: string
        member_id: string
        item_id: string
        request_fingerprint: string
        action_kind: string
        outcome_status: 'pending' | 'applied' | 'skipped'
        canonical_place_id: string | null
      }>(
        `SELECT command_id, member_id, item_id, request_fingerprint, action_kind,
                outcome_status, canonical_place_id
         FROM ingestion.import_review_receipts
         WHERE item_id = $1::uuid OR command_id = $2::uuid
         FOR UPDATE`,
        [input.itemId, input.commandId],
      )
      const prior = receipt.rows[0]
      if (prior !== undefined) {
        const same = prior.command_id === input.commandId &&
          prior.member_id === input.memberId &&
          prior.item_id === input.itemId &&
          prior.request_fingerprint === input.requestFingerprint &&
          prior.action_kind === input.actionKind
        if (!same) {
          await client.query('ROLLBACK')
          return { status: 'conflict' as const }
        }
        if (prior.outcome_status !== 'pending') {
          await client.query('COMMIT')
          return {
            status: 'replayed' as const,
            result: {
              status: 'replayed' as const,
              commandId: prior.command_id,
              itemId: prior.item_id,
              ...(prior.canonical_place_id === null
                ? {}
                : { canonicalPlaceId: prior.canonical_place_id }),
            },
          }
        }
      } else {
        if (row.item_status !== 'ready' && row.item_status !== 'needs-review') {
          await client.query('ROLLBACK')
          return { status: 'conflict' as const }
        }
        if (input.actionKind !== 'skip' && row.provider_place_id === null) {
          await client.query('ROLLBACK')
          return { status: 'invalid' as const }
        }
        await client.query(
          `INSERT INTO ingestion.import_review_receipts (
             command_id, member_id, item_id, request_fingerprint, action_kind,
             outcome_status, created_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'pending',$6::timestamptz)`,
          [input.commandId, input.memberId, input.itemId, input.requestFingerprint,
            input.actionKind, input.occurredAt],
        )
      }
      const reviewable: ReviewableImportItem = {
        itemId: row.item_id,
        batchId: row.batch_id,
        memberId: row.member_id,
        connectionId: row.connection_id,
        providerKey: row.provider_key,
        ...(row.provider_place_id === null ? {} : { providerPlaceId: row.provider_place_id }),
        sourceListId: row.source_list_id,
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
      await client.query('COMMIT')
      return { status: 'ready' as const, item: reviewable }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) return { status: 'conflict' as const }
      throw error
    } finally {
      client.release()
    }
  }

  async completeReview(
    input: Parameters<ImportReviewStore['completeReview']>[0],
  ): Promise<ImportReviewResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{
        outcome_status: 'pending' | 'applied' | 'skipped'
        canonical_place_id: string | null
        batch_id: string
      }>(
        `SELECT receipt.outcome_status, receipt.canonical_place_id, imported.batch_id
         FROM ingestion.import_review_receipts AS receipt
         JOIN ingestion.import_items AS imported ON imported.id = receipt.item_id
         WHERE receipt.command_id = $1::uuid AND receipt.member_id = $2::uuid
           AND receipt.item_id = $3::uuid
         FOR UPDATE OF receipt, imported`,
        [input.commandId, input.memberId, input.itemId],
      )
      const prior = receipt.rows[0]
      if (prior === undefined) throw new ImportReferenceUnavailableError('Review receipt is unavailable.')
      if (prior.outcome_status !== 'pending') {
        await client.query('COMMIT')
        return {
          status: 'replayed',
          commandId: input.commandId,
          itemId: input.itemId,
          ...(prior.canonical_place_id === null
            ? {}
            : { canonicalPlaceId: prior.canonical_place_id }),
        }
      }
      await client.query(
        `UPDATE ingestion.import_items
         SET status = $2, canonical_place_id = $3::uuid, updated_at = $4::timestamptz
         WHERE id = $1::uuid`,
        [input.itemId, input.status, input.canonicalPlaceId ?? null, input.completedAt],
      )
      await client.query(
        `UPDATE ingestion.import_review_receipts
         SET outcome_status = $2, canonical_place_id = $3::uuid, completed_at = $4::timestamptz
         WHERE command_id = $1::uuid`,
        [input.commandId, input.status, input.canonicalPlaceId ?? null, input.completedAt],
      )
      await refreshBatchProgress(client, prior.batch_id, input.completedAt)
      await client.query('COMMIT')
      return {
        status: input.status,
        commandId: input.commandId,
        itemId: input.itemId,
        ...(input.canonicalPlaceId === undefined
          ? {}
          : { canonicalPlaceId: input.canonicalPlaceId }),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

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
                imported.source_list_id, imported.source_list_position,
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

  async completeFulfillmentItem(input: Readonly<{
    claim: ImportedPlaceFulfillmentClaim
    itemId: string
    canonicalPlaceId: string
    completedAt: string
  }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const completed = await client.query<{ batch_id: string }>(
        `WITH owned AS (
           SELECT id FROM ingestion.import_place_fulfillment_jobs
           WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
             AND lease_generation = $3
           FOR UPDATE
         ), updated_intent AS (
           UPDATE ingestion.import_place_fulfillment_intents AS intent
           SET state = 'applied', canonical_place_id = $5::uuid,
               updated_at = $6::timestamptz
           FROM owned
           WHERE intent.job_id = owned.id AND intent.item_id = $4::uuid
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
          input.itemId, input.canonicalPlaceId, input.completedAt],
      )
      const row = completed.rows[0]
      if (row === undefined) throw new ImportLeaseLostError()
      await refreshBatchProgress(client, row.batch_id, input.completedAt)
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
      for (const row of batches.rows) {
        await refreshBatchProgress(client, row.batch_id, input.finishedAt)
        if (input.outcome.kind === 'failure') {
          await client.query(
            `UPDATE ingestion.import_batches
             SET failure_code = $2, failure_retryable = $3
             WHERE id = $1::uuid AND state <> 'cancelled'`,
            [row.batch_id, input.outcome.code, input.outcome.retryable],
          )
        }
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private claim(row: ClaimRow): ImportClaim {
    return {
      jobId: row.job_id,
      batchId: row.batch_id,
      memberId: row.member_id,
      connection: {
        connectionId: row.connection_id,
        providerKey: row.provider_key,
        ...(row.secret_reference === null ? {} : { secretReference: row.secret_reference }),
        ...(row.profile_reference === null ? {} : { profileReference: row.profile_reference }),
      },
      attemptCount: row.attempt_count,
      cursor: row.cursor,
      lease: {
        owner: row.lease_owner,
        generation: Number(row.lease_generation),
        expiresAt: iso(row.lease_expires_at),
      },
      cancellationRequestedAt: row.cancellation_requested_at === null
        ? null
        : iso(row.cancellation_requested_at),
    }
  }

  private async finishOwnedAttempt(
    client: PoolClient,
    claim: ImportClaim,
    outcome: ImportAttemptOutcome,
    finishedAt: string,
  ): Promise<void> {
    await client.query(
      `UPDATE ingestion.import_attempts
       SET finished_at = $4::timestamptz, outcome_kind = $5,
           outcome_code = $6, retryable = $7
       WHERE job_id = $1::uuid AND generation = $2 AND worker_reference = $3`,
      [claim.jobId, claim.lease.generation, claim.lease.owner, finishedAt,
        outcome.kind, outcome.kind === 'cancelled' ? null : outcome.code,
        outcome.kind === 'failure' ? outcome.retryable : null],
    )
    if (outcome.kind === 'cancelled') {
      await client.query(
        `UPDATE ingestion.import_jobs SET state = 'cancelled', lease_owner = NULL,
           lease_expires_at = NULL, updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [claim.jobId, finishedAt],
      )
      await client.query(
        `UPDATE ingestion.import_batches SET state = 'cancelled', updated_at = $2::timestamptz
         WHERE id = $1::uuid`,
        [claim.batchId, finishedAt],
      )
      return
    }
    if (outcome.kind === 'needs-user-action') {
      await client.query(
        `UPDATE ingestion.import_jobs SET state = 'action-required', lease_owner = NULL,
           lease_expires_at = NULL, updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [claim.jobId, finishedAt],
      )
      await client.query(
        `UPDATE ingestion.import_batches
         SET state = 'needs-user-action', failure_code = $2, failure_retryable = false,
             updated_at = $3::timestamptz WHERE id = $1::uuid`,
        [claim.batchId, outcome.code, finishedAt],
      )
      if (['provider-auth-expired', 'provider-mfa-required', 'provider-captcha-required', 'provider-consent-required'].includes(outcome.code)) {
        await client.query(
          `UPDATE ingestion.provider_connections SET status = 'action-required', updated_at = $2::timestamptz
           WHERE id = $1::uuid`,
          [claim.connection.connectionId, finishedAt],
        )
      }
      return
    }
    const retry = outcome.retryable && outcome.retryAt !== undefined
    await client.query(
      `UPDATE ingestion.import_jobs
       SET state = $2, available_at = $3::timestamptz,
           lease_owner = NULL, lease_expires_at = NULL, updated_at = $4::timestamptz
       WHERE id = $1::uuid`,
      [claim.jobId, retry ? 'waiting' : 'failed', outcome.retryAt ?? finishedAt, finishedAt],
    )
    await client.query(
      `UPDATE ingestion.import_batches
       SET state = $2, failure_code = $3, failure_retryable = $4,
           updated_at = $5::timestamptz WHERE id = $1::uuid`,
      [claim.batchId, retry ? 'partial' : 'failed', outcome.code, retry, finishedAt],
    )
  }
}
