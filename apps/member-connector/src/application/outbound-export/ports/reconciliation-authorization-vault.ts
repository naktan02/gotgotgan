import type {
  OutboundExecutionAuthorizationReceiptV2,
} from '@place/contracts/transfers'

/**
 * Secret persistence used after a Connector restart. Production implementations must use an OS
 * credential vault or authenticated encryption at rest, must never enumerate values, and must
 * never expose the receipt token to logs, diagnostics, Provider adapters, or the attempt spool.
 */
export interface OutboundReconciliationAuthorizationVault {
  seal(
    authorization: OutboundExecutionAuthorizationReceiptV2,
  ): Promise<'sealed' | 'replayed' | 'conflict'>

  load(
    receiptReference: string,
  ): Promise<OutboundExecutionAuthorizationReceiptV2 | null>
}
