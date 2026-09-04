import { ConnectorCaptureContext } from './capture-context.js'

export class ConnectorCaptureExpirySweeper {
  constructor(private readonly context: ConnectorCaptureContext) {}

  async sweep(limit: number): Promise<number> {
    const at = this.context.now().toISOString()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const expired = await client.query<{ manifest_id: string; operation_id: string }>(
        `SELECT manifest.manifest_id, manifest.operation_id
         FROM transfers.connector_capture_manifests AS manifest
         JOIN transfers.operations AS operation ON operation.id = manifest.operation_id
         WHERE manifest.status = 'receiving'
           AND operation.state IN ('queued','running')
           AND EXISTS (
             SELECT 1 FROM transfers.connector_import_grants AS issued_grant
             WHERE issued_grant.manifest_id = manifest.manifest_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM transfers.connector_import_grants AS issued_grant
             WHERE issued_grant.manifest_id = manifest.manifest_id
               AND issued_grant.status = 'active'
               AND issued_grant.expires_at > $1::timestamptz
           )
         ORDER BY manifest.captured_at, manifest.manifest_id
         FOR UPDATE OF manifest, operation SKIP LOCKED LIMIT $2`,
        [at, limit],
      )
      for (const row of expired.rows) {
        await client.query(
          `UPDATE transfers.connector_import_grants SET status = 'expired'
           WHERE manifest_id = $1::uuid AND status = 'active'
             AND expires_at <= $2::timestamptz`,
          [row.manifest_id, at],
        )
        await client.query(
          `UPDATE transfers.connector_capture_manifests SET status = 'expired'
           WHERE manifest_id = $1::uuid AND status = 'receiving'`,
          [row.manifest_id],
        )
        await client.query(
          `UPDATE transfers.operations SET state = 'failed', revision = revision + 1,
             lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = 'connector-grant-expired', last_error_retryable = true,
             updated_at = $2::timestamptz, completed_at = $2::timestamptz
           WHERE id = $1::uuid AND state IN ('queued','running')`,
          [row.operation_id, at],
        )
      }
      await client.query('COMMIT')
      return expired.rowCount ?? expired.rows.length
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}
