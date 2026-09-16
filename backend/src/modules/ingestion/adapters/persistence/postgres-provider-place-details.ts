import type { Pool } from 'pg'

import type {
  ProviderPlaceDetailClaim,
  ProviderPlaceDetailJobStore,
} from '../../application/ports/provider-place-detail.js'
import { ImportLeaseLostError } from '../../domain/imports.js'
import { iso } from './postgres-import-common.js'

type DetailClaimRow = Readonly<{
  job_id: string
  provider_key: ProviderPlaceDetailClaim['providerKey']
  provider_place_id: string
  attempt_count: number
  observation_id: string
  candidate_id: string
  lease_owner: string
  lease_generation: number | string
  lease_expires_at: string | Date
}>

export class PostgresProviderPlaceDetails implements ProviderPlaceDetailJobStore {
  constructor(private readonly pool: Pool) {}

  async scheduleStale(input: Readonly<{
    providerKeys: readonly ProviderPlaceDetailClaim['providerKey'][]
    staleBefore: string
    scheduledAt: string
    limit: number
  }>): Promise<number> {
    const scheduled = await this.pool.query(
      `WITH stale AS (
         SELECT status.provider_key, status.provider_place_id
         FROM ingestion.provider_place_detail_statuses AS status
         JOIN LATERAL (
           SELECT job.state, job.failure_code, job.updated_at
           FROM ingestion.provider_place_detail_jobs AS job
           WHERE job.provider_key = status.provider_key
             AND job.provider_place_id = status.provider_place_id
           ORDER BY job.created_at DESC, job.id DESC
           LIMIT 1
         ) AS latest ON true
         WHERE status.provider_key = ANY($1::text[])
           AND status.status = 'available'
           AND greatest(status.updated_at, latest.updated_at) <= $2::timestamptz
           AND (
             latest.state = 'completed'
             OR (
               latest.state = 'failed'
               AND latest.failure_code IN (
                 'provider-rate-limited', 'provider-unavailable'
               )
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM ingestion.provider_place_detail_jobs AS active
             WHERE active.provider_key = status.provider_key
               AND active.provider_place_id = status.provider_place_id
               AND active.state IN ('queued', 'waiting', 'leased')
           )
         ORDER BY greatest(status.updated_at, latest.updated_at),
                  status.provider_key, status.provider_place_id
         FOR UPDATE OF status SKIP LOCKED
         LIMIT $4
       )
       INSERT INTO ingestion.provider_place_detail_jobs (
         id, provider_key, provider_place_id, state, available_at,
         observation_id, candidate_id, created_at, updated_at
       )
       SELECT gen_random_uuid(), stale.provider_key, stale.provider_place_id,
              'queued', $3::timestamptz, gen_random_uuid(), gen_random_uuid(),
              $3::timestamptz, $3::timestamptz
       FROM stale
       ON CONFLICT (provider_key, provider_place_id)
         WHERE state IN ('queued', 'waiting', 'leased')
       DO NOTHING
       RETURNING id`,
      [input.providerKeys, input.staleBefore, input.scheduledAt, input.limit],
    )
    return scheduled.rowCount ?? 0
  }

  async claimNext(input: Readonly<{
    workerId: string
    providerKeys: readonly ProviderPlaceDetailClaim['providerKey'][]
    claimedAt: string
    leaseUntil: string
  }>): Promise<ProviderPlaceDetailClaim | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const claimed = await client.query<DetailClaimRow>(
        `WITH candidate AS (
           SELECT job.id
           FROM ingestion.provider_place_detail_jobs AS job
           JOIN ingestion.provider_place_detail_statuses AS status
             ON status.provider_key = job.provider_key
            AND status.provider_place_id = job.provider_place_id
           WHERE job.provider_key = ANY($1::text[])
             AND status.status IN ('pending', 'available')
             AND job.available_at <= $3::timestamptz
             AND (
               job.state IN ('queued', 'waiting')
               OR (job.state = 'leased' AND job.lease_expires_at <= $3::timestamptz)
             )
           ORDER BY job.available_at, job.id
           FOR UPDATE OF job SKIP LOCKED
           LIMIT 1
         ), claimed AS (
           UPDATE ingestion.provider_place_detail_jobs AS job
           SET state = 'leased', lease_owner = $2,
               lease_generation = job.lease_generation + 1,
               lease_expires_at = $4::timestamptz,
               attempt_count = job.attempt_count + 1,
               updated_at = $3::timestamptz
           FROM candidate
           WHERE job.id = candidate.id
           RETURNING job.*
         )
         SELECT id AS job_id, provider_key, provider_place_id, attempt_count,
                observation_id, candidate_id, lease_owner,
                lease_generation, lease_expires_at
         FROM claimed`,
        [input.providerKeys, input.workerId, input.claimedAt, input.leaseUntil],
      )
      const row = claimed.rows[0]
      if (row === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      await client.query(
        `UPDATE ingestion.provider_place_detail_attempts
         SET finished_at = $2::timestamptz, outcome_kind = 'failure',
             outcome_code = 'lease-expired', retryable = true
         WHERE job_id = $1::uuid AND finished_at IS NULL`,
        [row.job_id, input.claimedAt],
      )
      await client.query(
        `INSERT INTO ingestion.provider_place_detail_attempts (
           job_id, generation, worker_reference, started_at
         ) VALUES ($1::uuid,$2,$3,$4::timestamptz)`,
        [row.job_id, row.lease_generation, input.workerId, input.claimedAt],
      )
      await client.query('COMMIT')
      return {
        jobId: row.job_id,
        providerKey: row.provider_key,
        providerPlaceId: row.provider_place_id,
        attemptCount: row.attempt_count,
        observationId: row.observation_id,
        candidateId: row.candidate_id,
        lease: {
          owner: row.lease_owner,
          generation: Number(row.lease_generation),
          expiresAt: iso(row.lease_expires_at),
        },
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async renewLease(input: Readonly<{
    claim: ProviderPlaceDetailClaim
    renewedAt: string
    leaseUntil: string
  }>): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ingestion.provider_place_detail_jobs
       SET lease_expires_at = $4::timestamptz, updated_at = $3::timestamptz
       WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
         AND lease_generation = $5 AND lease_expires_at > $3::timestamptz`,
      [input.claim.jobId, input.claim.lease.owner, input.renewedAt,
        input.leaseUntil, input.claim.lease.generation],
    )
    return result.rowCount === 1
  }

  async complete(input: Readonly<{
    claim: ProviderPlaceDetailClaim
    completedAt: string
  }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const owned = await client.query(
        `SELECT 1 FROM ingestion.provider_place_detail_jobs
         WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
           AND lease_generation = $3
         FOR UPDATE`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation],
      )
      if (owned.rows[0] === undefined) throw new ImportLeaseLostError()
      await client.query(
        `INSERT INTO ingestion.provider_place_detail_observations (
           provider_key, provider_place_id, source_observation_id,
           place_candidate_id, normalized_at,
           previous_source_observation_id, change_kind
         )
         SELECT $1, $2, $3::uuid, $4::uuid, $5::timestamptz,
                status.last_detail_observation_id,
                CASE
                  WHEN status.last_detail_observation_id IS NULL THEN 'initial'
                  WHEN previous.payload_checksum = current.payload_checksum THEN 'unchanged'
                  ELSE 'changed'
                END
         FROM ingestion.provider_place_detail_statuses AS status
         JOIN ingestion.source_observations AS current
           ON current.id = $3::uuid
          AND current.provider_key = status.provider_key
          AND current.external_place_id = status.provider_place_id
         LEFT JOIN ingestion.source_observations AS previous
           ON previous.id = status.last_detail_observation_id
         WHERE status.provider_key = $1 AND status.provider_place_id = $2
         ON CONFLICT (provider_key, provider_place_id, source_observation_id) DO NOTHING`,
        [input.claim.providerKey, input.claim.providerPlaceId,
          input.claim.observationId, input.claim.candidateId, input.completedAt],
      )
      await client.query(
        `UPDATE ingestion.provider_place_detail_statuses
         SET status = 'available', last_detail_observation_id = $3::uuid,
             updated_at = $4::timestamptz
         WHERE provider_key = $1 AND provider_place_id = $2`,
        [input.claim.providerKey, input.claim.providerPlaceId,
          input.claim.observationId, input.completedAt],
      )
      await client.query(
        `UPDATE ingestion.provider_place_detail_attempts
         SET finished_at = $4::timestamptz, outcome_kind = 'completed',
             outcome_code = NULL, retryable = NULL
         WHERE job_id = $1::uuid AND generation = $2 AND worker_reference = $3`,
        [input.claim.jobId, input.claim.lease.generation,
          input.claim.lease.owner, input.completedAt],
      )
      await client.query(
        `UPDATE ingestion.provider_place_detail_jobs
         SET state = 'completed', completed_at = $4::timestamptz,
             failure_code = NULL, failure_retryable = NULL,
             lease_owner = NULL, lease_expires_at = NULL,
             updated_at = $4::timestamptz
         WHERE id = $1::uuid AND lease_owner = $2 AND lease_generation = $3`,
        [input.claim.jobId, input.claim.lease.owner,
          input.claim.lease.generation, input.completedAt],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async finishFailure(input: Parameters<ProviderPlaceDetailJobStore['finishFailure']>[0]) {
    const retry = input.retryable && input.retryAt !== undefined
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const owned = await client.query(
        `SELECT 1 FROM ingestion.provider_place_detail_jobs
         WHERE id = $1::uuid AND state = 'leased' AND lease_owner = $2
           AND lease_generation = $3
         FOR UPDATE`,
        [input.claim.jobId, input.claim.lease.owner, input.claim.lease.generation],
      )
      if (owned.rows[0] === undefined) throw new ImportLeaseLostError()
      await client.query(
        `UPDATE ingestion.provider_place_detail_attempts
         SET finished_at = $4::timestamptz, outcome_kind = 'failure',
             outcome_code = $5, retryable = $6
         WHERE job_id = $1::uuid AND generation = $2 AND worker_reference = $3`,
        [input.claim.jobId, input.claim.lease.generation,
          input.claim.lease.owner, input.finishedAt, input.code, input.retryable],
      )
      await client.query(
        `UPDATE ingestion.provider_place_detail_jobs
         SET state = $4, available_at = $5::timestamptz,
             failure_code = $6, failure_retryable = $7,
             lease_owner = NULL, lease_expires_at = NULL,
             updated_at = $8::timestamptz
         WHERE id = $1::uuid AND lease_owner = $2 AND lease_generation = $3`,
        [input.claim.jobId, input.claim.lease.owner,
          input.claim.lease.generation, retry ? 'waiting' : 'failed',
          input.retryAt ?? input.finishedAt, input.code, input.retryable,
          input.finishedAt],
      )
      if (!retry) {
        await client.query(
          `UPDATE ingestion.provider_place_detail_statuses
           SET status = 'unavailable', last_detail_observation_id = NULL,
               updated_at = $3::timestamptz
           WHERE provider_key = $1 AND provider_place_id = $2
             AND status = 'pending'`,
          [input.claim.providerKey, input.claim.providerPlaceId, input.finishedAt],
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
