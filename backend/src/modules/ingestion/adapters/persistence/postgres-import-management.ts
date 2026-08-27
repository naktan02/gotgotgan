import type { Pool } from 'pg'

import type { ImportManagementStore } from '../../application/ports/import-management-store.js'
import { selectBatch } from './postgres-import-common.js'

export class PostgresImportManagement implements ImportManagementStore {
  constructor(private readonly pool: Pool) {}

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
}
