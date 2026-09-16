import { transferFingerprint } from '../../../application/identity.js'
import { ConnectorTransferAuthorizationError, type OutboundExecutionControl } from '../../../domain/operations.js'
import { OutboundExecutionContext } from './execution-context.js'

export class OutboundReconciliationLedger {
  constructor(private readonly context: OutboundExecutionContext) {}

  async record(input: Parameters<OutboundExecutionControl['recordReconciliation']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const value = input.reconciliation
      const phase: string = value.phase
      const reconciliationOutcome: string = value.outcome
      if (phase === 'create-target-list' && reconciliationOutcome === 'resolved-partial') {
        throw new ConnectorTransferAuthorizationError()
      }
      const grant = await this.context.authorizeReceipt(
        client, input.receiptToken, input.sourceOrigin,
        value.operationId, value.receiptReference, 'reconciliation',
      )
      const fingerprint = transferFingerprint(value)
      const prior = (await client.query<{ request_fingerprint: string }>(
        `SELECT request_fingerprint FROM transfers.outbound_reconciliations
         WHERE reconciliation_id = $1::uuid`,
        [value.reconciliationId],
      )).rows[0]
      let outcome: 'recorded' | 'replayed' = 'recorded'
      if (prior !== undefined) {
        if (prior.request_fingerprint !== fingerprint) {
          throw new ConnectorTransferAuthorizationError()
        }
        outcome = 'replayed'
      } else {
        if (grant.operation_state !== 'outcome-unknown') {
          throw new ConnectorTransferAuthorizationError()
        }
        const attempt = (await client.query<{
          reconciliation_reference: string
          phase: 'create-target-list' | 'add-items'
          target_list_id: string | null
          sequence: number
          final: boolean
        }>(
          `SELECT reconciliation_reference, phase, target_list_id, sequence, final
           FROM transfers.outbound_execution_attempt_intents
           WHERE attempt_id = $1::uuid AND operation_id = $2::uuid`,
          [value.attemptId, value.operationId],
        )).rows[0]
        if (attempt?.reconciliation_reference !== value.reconciliationReference ||
          attempt.phase !== value.phase ||
          (value.phase === 'add-items' && attempt.target_list_id !== value.targetListId) ||
          (value.phase === 'create-target-list' && value.outcome === 'resolved-completed' &&
            value.targetListId === null)) {
          throw new ConnectorTransferAuthorizationError()
        }
        const expectedItems = await client.query<{
          item_key: string
          target_reference: string | null
        }>(
          `SELECT intent_item.item_key, intent_item.target_reference
           FROM transfers.outbound_execution_attempt_intent_items AS intent_item
           LEFT JOIN transfers.outbound_execution_attempt_items AS result_item
             ON result_item.attempt_id = intent_item.attempt_id
            AND result_item.item_key = intent_item.item_key
           WHERE intent_item.attempt_id = $1::uuid
             AND (result_item.attempt_id IS NULL OR result_item.status = 'outcome-unknown')
           ORDER BY intent_item.item_key`,
          [value.attemptId],
        )
        const observedItems = [...value.items]
          .sort((left, right) => left.itemKey.localeCompare(right.itemKey))
        if (expectedItems.rows.length !== observedItems.length ||
          expectedItems.rows.some((item, index) =>
            item.item_key !== observedItems[index]?.itemKey ||
            item.target_reference !== observedItems[index]?.targetReference) ||
          (value.outcome === 'resolved-completed' &&
            observedItems.some((item) => item.status !== 'present')) ||
          (value.outcome === 'resolved-partial' &&
            observedItems.some((item) => item.status === 'unknown')) ||
          (value.outcome === 'still-unknown' && value.phase === 'add-items' &&
            !observedItems.some((item) => item.status === 'unknown'))) {
          throw new ConnectorTransferAuthorizationError()
        }
        const latest = (await client.query<{ outcome: string }>(
          `SELECT outcome FROM transfers.outbound_reconciliations
           WHERE operation_id = $1::uuid AND reconciliation_reference = $2
           ORDER BY observation_sequence DESC LIMIT 1`,
          [value.operationId, value.reconciliationReference],
        )).rows[0]
        if (latest !== undefined && latest.outcome !== 'still-unknown') {
          throw new ConnectorTransferAuthorizationError()
        }
        await client.query(
          `INSERT INTO transfers.outbound_reconciliations (
             reconciliation_id, operation_id, attempt_id, receipt_reference, phase,
             target_list_id, reconciliation_reference, request_fingerprint, outcome, recorded_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::timestamptz)`,
          [value.reconciliationId, value.operationId, value.attemptId,
            value.receiptReference, value.phase, value.targetListId,
            value.reconciliationReference, fingerprint, value.outcome,
            this.context.now().toISOString()],
        )
        for (const item of value.items) {
          await client.query(
            `INSERT INTO transfers.outbound_reconciliation_items (
               reconciliation_id, operation_id, reconciliation_reference, item_key, status,
               target_reference
             ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
            [value.reconciliationId, value.operationId, value.reconciliationReference,
              item.itemKey, item.status, item.targetReference],
          )
          const status = item.status === 'present'
            ? 'applied'
            : item.status === 'absent' ? 'failed' : 'outcome-unknown'
          await client.query(
            `UPDATE transfers.operation_items SET status = $3, target_reference = $4,
               code = CASE WHEN $3 = 'failed' THEN 'reconciled-absent' ELSE NULL END,
               retryable = CASE WHEN $3 = 'failed' THEN true ELSE NULL END,
               reconciliation_reference = CASE WHEN $3 = 'outcome-unknown' THEN $5 ELSE NULL END,
               updated_at = $6::timestamptz
             WHERE operation_id = $1::uuid AND item_key = $2`,
            [value.operationId, item.itemKey, status, item.targetReference,
              value.reconciliationReference, this.context.now().toISOString()],
          )
        }
        await client.query(
          `UPDATE transfers.outbound_execution_attempt_intents
           SET state = $2, target_list_id = coalesce($3, target_list_id)
           WHERE attempt_id = $1::uuid`,
          [value.attemptId,
            value.outcome === 'resolved-completed'
              ? 'reconciled-completed'
              : value.outcome === 'resolved-partial' ? 'reconciled-partial' : 'unknown',
            value.targetListId],
        )
        await this.context.refreshOperation(client, {
          operationId: value.operationId,
          receiptReference: value.receiptReference,
          attemptId: value.attemptId,
          phase: value.phase,
          targetListId: value.targetListId,
          sequence: attempt.sequence,
          final: attempt.final,
          outcome: value.outcome === 'still-unknown'
            ? 'outcome-unknown'
            : value.outcome === 'resolved-completed' ? 'completed' : 'partial',
          reconciliationReference: value.outcome === 'still-unknown'
            ? value.reconciliationReference
            : null,
          items: [],
        })
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
