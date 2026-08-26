import type { Pool, PoolClient } from 'pg'

import type { ImportRequestCommand, ImportRequestStore } from '../../application/ports/import-request-store.js'
import type {
  ImportAttemptOutcome,
  ImportClaim,
  ImportWorkerStore,
} from '../../application/ports/import-worker-store.js'
import {
  ImportLeaseLostError,
  ImportRequestConflictError,
  ProviderConnectionUnavailableError,
} from '../../domain/imports.js'
import {
  type BatchRow,
  batch,
  insertPreparedImportItems,
  iso,
  isUniqueViolation,
  selectBatch,
  updateImportBatchAfterCapture,
} from './postgres-import-common.js'

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

export class PostgresImportQueue implements ImportRequestStore, ImportWorkerStore {
  constructor(private readonly pool: Pool) {}

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
      await insertPreparedImportItems(client, {
        batchId: input.claim.batchId,
        captureId: input.capture.artifactId,
        providerKey: input.claim.connection.providerKey,
        items: input.items,
        recordedAt: input.recordedAt,
      })
      const state = await updateImportBatchAfterCapture(
        client, input.claim.batchId, input.nextCursor === null, input.recordedAt,
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
