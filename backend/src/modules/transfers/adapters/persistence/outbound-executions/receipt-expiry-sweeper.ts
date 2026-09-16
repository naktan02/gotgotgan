import { OutboundExecutionContext } from './execution-context.js'

export class OutboundReceiptExpirySweeper {
  constructor(private readonly context: OutboundExecutionContext) {}

  async sweep(limit: number): Promise<number> {
    const at = this.context.now().toISOString()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const expired = await client.query<{
        operation_id: string
        grant_id: string
        cancel_requested: boolean
      }>(
        `SELECT execution_grant.operation_id, execution_grant.grant_id,
                operation.cancel_requested
         FROM transfers.outbound_execution_grants AS execution_grant
         JOIN transfers.operations AS operation ON operation.id = execution_grant.operation_id
         WHERE execution_grant.status = 'consumed'
           AND execution_grant.receipt_expires_at <= $1::timestamptz
           AND operation.state = 'running'
         ORDER BY execution_grant.receipt_expires_at, execution_grant.grant_id
         FOR UPDATE SKIP LOCKED LIMIT $2`,
        [at, limit],
      )
      for (const row of expired.rows) {
        const intent = (await client.query<{
          attempt_id: string
          phase: 'create-target-list' | 'add-items'
          reconciliation_reference: string
        }>(
          `SELECT attempt_id, phase, reconciliation_reference
           FROM transfers.outbound_execution_attempt_intents
           WHERE grant_id = $1::uuid AND state = 'prepared'
           ORDER BY prepared_at, attempt_id FOR UPDATE LIMIT 1`, [row.grant_id],
        )).rows[0]
        if (intent === undefined) {
          const state = row.cancel_requested ? 'cancelled' : 'partial-failure'
          await client.query(
            `UPDATE transfers.operations SET state = $2,
               stage = CASE WHEN $2 = 'cancelled' THEN 'externally-completed'
                            ELSE 'executing-provider-write' END,
               revision = revision + 1,
               last_error_code = CASE WHEN $2 = 'cancelled' THEN NULL
                                      ELSE 'execution-intent-not-started' END,
               last_error_retryable = CASE WHEN $2 = 'cancelled' THEN NULL ELSE true END,
               completed_at = CASE WHEN $2 = 'cancelled' THEN $3::timestamptz ELSE NULL END,
               updated_at = $3::timestamptz
             WHERE id = $1::uuid`, [row.operation_id, state, at],
          )
          if (row.cancel_requested) {
            await client.query(
              `UPDATE transfers.outbound_transfers SET state = 'cancelled',
                 blocked_reason = NULL, revision = revision + 1, updated_at = $2::timestamptz
               WHERE operation_id = $1::uuid`, [row.operation_id, at],
            )
          }
          continue
        }
        await client.query(
          `UPDATE transfers.outbound_execution_attempt_intents SET state = 'expired'
           WHERE attempt_id = $1::uuid AND state = 'prepared'`, [intent.attempt_id],
        )
        if (intent.phase === 'add-items') {
          await client.query(
            `UPDATE transfers.operation_items AS operation_item
             SET status = 'outcome-unknown', reconciliation_reference = $3,
                 updated_at = $4::timestamptz
             FROM transfers.outbound_execution_attempt_intent_items AS intent_item
             WHERE intent_item.attempt_id = $2::uuid
               AND intent_item.operation_id = operation_item.operation_id
               AND intent_item.item_key = operation_item.item_key
               AND operation_item.operation_id = $1::uuid
               AND operation_item.status = 'pending'`,
            [row.operation_id, intent.attempt_id, intent.reconciliation_reference, at],
          )
        }
        await client.query(
          `UPDATE transfers.operations AS operation SET state = 'outcome-unknown',
             stage = 'reconciling', revision = revision + 1, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = $2::timestamptz,
             processed_count = summary.processed, applied_count = summary.applied,
             failed_count = summary.failed, outcome_unknown_count = summary.unknown
           FROM (SELECT count(*) FILTER (WHERE status <> 'pending')::int AS processed,
                        count(*) FILTER (WHERE status IN ('applied','already-present'))::int AS applied,
                        count(*) FILTER (WHERE status = 'failed')::int AS failed,
                        count(*) FILTER (WHERE status = 'outcome-unknown')::int AS unknown
                 FROM transfers.operation_items WHERE operation_id = $1::uuid) AS summary
           WHERE operation.id = $1::uuid`, [row.operation_id, at],
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
