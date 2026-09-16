import type {
  OutboundExecutionAttemptReceiptV2,
  OutboundExecutionAttemptV2,
  OutboundExecutionAuthorizationReceiptV2,
  OutboundExecutionAttemptIntentReceiptV2,
  OutboundExecutionAttemptIntentV2,
  OutboundExecutionConsumeRequestV2,
  OutboundExecutionGrantV2,
  OutboundExecutionReconciliationReceiptV2,
  OutboundExecutionReconciliationV2,
} from '@place/contracts/transfers'

export type OutboundExecutionControlBoundary = Readonly<{
  status: 'action-required' | 'conflict' | 'expired' | 'rejected' | 'unavailable'
  retryable: boolean
  code: string
}>

/**
 * Backend control-plane seam. The bearer token is passed separately so it can be sent only in the
 * PlaceConnector authorization header and never serialized into a JSON request, receipt, or log.
 */
export interface OutboundExecutionControl {
  consume(input: Readonly<{
    token: OutboundExecutionGrantV2['token']
    request: OutboundExecutionConsumeRequestV2
    signal: AbortSignal
  }>): Promise<OutboundExecutionAuthorizationReceiptV2 | OutboundExecutionControlBoundary>

  prepareAttempt(input: Readonly<{
    receiptToken: OutboundExecutionAuthorizationReceiptV2['receiptToken']
    intent: OutboundExecutionAttemptIntentV2
    signal: AbortSignal
  }>): Promise<OutboundExecutionAttemptIntentReceiptV2 | OutboundExecutionControlBoundary>

  recordAttempt(input: Readonly<{
    receiptToken: OutboundExecutionAuthorizationReceiptV2['receiptToken']
    attempt: OutboundExecutionAttemptV2
    signal: AbortSignal
  }>): Promise<OutboundExecutionAttemptReceiptV2 | OutboundExecutionControlBoundary>

  recordReconciliation(input: Readonly<{
    receiptToken: OutboundExecutionAuthorizationReceiptV2['receiptToken']
    reconciliation: OutboundExecutionReconciliationV2
    signal: AbortSignal
  }>): Promise<OutboundExecutionReconciliationReceiptV2 | OutboundExecutionControlBoundary>
}
