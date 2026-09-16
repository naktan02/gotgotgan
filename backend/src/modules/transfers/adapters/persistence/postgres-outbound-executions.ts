import type { Pool } from 'pg'

import type {
  OutboundExecutionControl,
  TransferOperationQueries,
} from '../../domain/operations.js'
import { OutboundAttemptLedger } from './outbound-executions/attempt-ledger.js'
import {
  OutboundExecutionContext,
  type OutboundExecutionOptions,
} from './outbound-executions/execution-context.js'
import { OutboundExecutionGrants } from './outbound-executions/execution-grants.js'
import { OutboundReceiptExpirySweeper } from './outbound-executions/receipt-expiry-sweeper.js'
import { OutboundReconciliationLedger } from './outbound-executions/reconciliation-ledger.js'

/**
 * Stable outbound-execution adapter seam. Authorization, durable write intent,
 * result reporting, reconciliation, and expiry stay private cohesive roles.
 */
export class PostgresOutboundExecutions implements OutboundExecutionControl {
  private readonly grants: OutboundExecutionGrants
  private readonly attempts: OutboundAttemptLedger
  private readonly reconciliations: OutboundReconciliationLedger
  private readonly expiry: OutboundReceiptExpirySweeper

  constructor(
    pool: Pool,
    operations: TransferOperationQueries,
    options: OutboundExecutionOptions,
  ) {
    const context = new OutboundExecutionContext(pool, operations, options)
    this.grants = new OutboundExecutionGrants(context)
    this.attempts = new OutboundAttemptLedger(context)
    this.reconciliations = new OutboundReconciliationLedger(context)
    this.expiry = new OutboundReceiptExpirySweeper(context)
  }

  issueGrant(
    ...input: Parameters<OutboundExecutionControl['issueGrant']>
  ): ReturnType<OutboundExecutionControl['issueGrant']> {
    return this.grants.issue(...input)
  }

  consume(
    ...input: Parameters<OutboundExecutionControl['consume']>
  ): ReturnType<OutboundExecutionControl['consume']> {
    return this.grants.consume(...input)
  }

  prepareAttempt(
    ...input: Parameters<OutboundExecutionControl['prepareAttempt']>
  ): ReturnType<OutboundExecutionControl['prepareAttempt']> {
    return this.attempts.prepare(...input)
  }

  recordAttempt(
    ...input: Parameters<OutboundExecutionControl['recordAttempt']>
  ): ReturnType<OutboundExecutionControl['recordAttempt']> {
    return this.attempts.record(...input)
  }

  recordReconciliation(
    ...input: Parameters<OutboundExecutionControl['recordReconciliation']>
  ): ReturnType<OutboundExecutionControl['recordReconciliation']> {
    return this.reconciliations.record(...input)
  }

  sweepExpiredReceipts(limit: number): Promise<number> {
    return this.expiry.sweep(limit)
  }
}
