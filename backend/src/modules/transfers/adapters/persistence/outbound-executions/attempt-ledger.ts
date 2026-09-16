import { transferFingerprint } from '../../../application/identity.js'
import { ConnectorTransferAuthorizationError, type OutboundExecutionControl } from '../../../domain/operations.js'
import { OutboundExecutionContext } from './execution-context.js'

export class OutboundAttemptLedger {
  constructor(private readonly context: OutboundExecutionContext) {}

  async prepare(input: Parameters<OutboundExecutionControl['prepareAttempt']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const intent = input.intent
      const grant = await this.context.authorizeReceipt(
        client, input.receiptToken, input.sourceOrigin,
        intent.operationId, intent.receiptReference, 'attempt',
      )
      const fingerprint = transferFingerprint(intent)
      const prior = (await client.query<{ request_fingerprint: string }>(
        `SELECT request_fingerprint FROM transfers.outbound_execution_attempt_intents
         WHERE attempt_id = $1::uuid`, [intent.attemptId],
      )).rows[0]
      if (prior !== undefined) {
        if (prior.request_fingerprint !== fingerprint) {
          throw new ConnectorTransferAuthorizationError()
        }
        await client.query('COMMIT')
        return {
          outcome: 'replayed' as const,
          operationId: intent.operationId,
          attemptId: intent.attemptId,
        }
      }
      if (grant.operation_state !== 'running' || grant.cancel_requested) {
        throw new ConnectorTransferAuthorizationError()
      }
      await this.context.validateAttemptIntent(client, grant, intent)
      await client.query(
        `INSERT INTO transfers.outbound_execution_attempt_intents (
           attempt_id, operation_id, grant_id, receipt_reference, phase, target_list_id,
           sequence, final, reconciliation_reference, state, request_fingerprint, prepared_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,'prepared',$10,$11::timestamptz)`,
        [intent.attemptId, intent.operationId, grant.grant_id, intent.receiptReference,
          intent.phase, intent.targetListId, intent.sequence, intent.final,
          intent.reconciliationReference, fingerprint, this.context.now().toISOString()],
      )
      for (const item of intent.items) {
        await client.query(
          `INSERT INTO transfers.outbound_execution_attempt_intent_items (
             attempt_id, operation_id, item_key, target_reference
           ) VALUES ($1::uuid,$2::uuid,$3,$4)`,
          [intent.attemptId, intent.operationId, item.itemKey, item.targetReference],
        )
      }
      await client.query('COMMIT')
      return {
        outcome: 'recorded' as const,
        operationId: intent.operationId,
        attemptId: intent.attemptId,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async record(input: Parameters<OutboundExecutionControl['recordAttempt']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const grant = await this.context.authorizeReceipt(
        client, input.receiptToken, input.sourceOrigin,
        input.attempt.operationId, input.attempt.receiptReference,
        input.attempt.outcome === 'outcome-unknown' ? 'unknown-attempt' : 'attempt',
      )
      const fingerprint = transferFingerprint(input.attempt)
      const prior = (await client.query<{ request_fingerprint: string }>(
        `SELECT request_fingerprint FROM transfers.outbound_execution_attempts
         WHERE attempt_id = $1::uuid`, [input.attempt.attemptId],
      )).rows[0]
      let outcome: 'recorded' | 'replayed' = 'recorded'
      if (prior !== undefined) {
        if (prior.request_fingerprint !== fingerprint) {
          throw new ConnectorTransferAuthorizationError()
        }
        outcome = 'replayed'
      } else {
        if (grant.operation_state !== 'running' &&
          !(grant.operation_state === 'outcome-unknown' &&
            input.attempt.outcome === 'outcome-unknown')) {
          throw new ConnectorTransferAuthorizationError()
        }
        await this.context.validatePreparedAttempt(client, grant, input.attempt)
        await client.query(
          `INSERT INTO transfers.outbound_execution_attempts (
             attempt_id, operation_id, grant_id, receipt_reference, phase, target_list_id,
             sequence, final, outcome, reconciliation_reference, problem_code,
             problem_retryable, problem_action_required, request_fingerprint, recorded_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz)`,
          [input.attempt.attemptId, input.attempt.operationId, grant.grant_id,
            input.attempt.receiptReference, input.attempt.phase, input.attempt.targetListId,
            input.attempt.sequence, input.attempt.final, input.attempt.outcome,
            input.attempt.reconciliationReference, input.attempt.problem?.code ?? null,
            input.attempt.problem?.retryable ?? null,
            input.attempt.problem?.actionRequired ?? null,
            fingerprint, this.context.now().toISOString()],
        )
        for (const item of input.attempt.items) {
          await client.query(
            `INSERT INTO transfers.outbound_execution_attempt_items (
               attempt_id, operation_id, item_key, target_reference, status, code,
               retryable, reconciliation_reference
             ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8)`,
            [input.attempt.attemptId, input.attempt.operationId, item.itemKey,
              item.targetReference, item.status, item.code, item.retryable,
              item.reconciliationReference],
          )
          await client.query(
            `UPDATE transfers.operation_items SET status = $3, target_reference = $4,
               code = $5, retryable = $6, reconciliation_reference = $7,
               updated_at = $8::timestamptz WHERE operation_id = $1::uuid AND item_key = $2`,
            [input.attempt.operationId, item.itemKey, item.status, item.targetReference,
              item.code, item.retryable, item.reconciliationReference,
              this.context.now().toISOString()],
          )
        }
        await client.query(
          `UPDATE transfers.outbound_execution_attempt_intents
           SET state = $2, target_list_id = coalesce($3, target_list_id)
           WHERE attempt_id = $1::uuid`,
          [input.attempt.attemptId,
            input.attempt.outcome === 'completed' ? 'completed'
              : input.attempt.outcome === 'partial' ? 'partial' : 'unknown',
            input.attempt.targetListId],
        )
        await this.context.refreshOperation(client, input.attempt)
      }
      await client.query('COMMIT')
      const operation = await this.context.operations.get(
        grant.owner_membership_id,
        grant.operation_id!,
      )
      if (operation === undefined) throw new Error('outbound operation projection unavailable')
      return { outcome, operation }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}
