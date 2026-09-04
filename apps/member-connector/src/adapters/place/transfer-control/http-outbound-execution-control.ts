import {
  outboundExecutionAttemptIntentReceiptV2Schema,
  outboundExecutionAttemptIntentV2Schema,
  outboundExecutionAttemptReceiptV2Schema,
  outboundExecutionAttemptV2Schema,
  outboundExecutionAuthorizationReceiptV2Schema,
  outboundExecutionConsumeRequestV2Schema,
  outboundExecutionReconciliationReceiptV2Schema,
  outboundExecutionReconciliationV2Schema,
} from '@place/contracts/transfers'

import type {
  OutboundExecutionControl,
  OutboundExecutionControlBoundary,
} from '../../../application/outbound-export/index.js'
import { PlaceTransferHttp, PlaceTransferHttpError } from './place-transfer-http.js'

function boundary(error: unknown): OutboundExecutionControlBoundary {
  if (!(error instanceof PlaceTransferHttpError)) {
    return { status: 'unavailable', retryable: true, code: 'PLACE_CONNECTOR_CONTROL_UNAVAILABLE' }
  }
  const actionRequired = /(?:REAUTH|MFA|CAPTCHA|CONSENT)_REQUIRED/u.test(error.code)
  const expired = /(?:EXPIRED|AUTHORIZATION_INVALID|GRANT_INVALID)/u.test(error.code)
  return {
    status: actionRequired ? 'action-required'
      : expired ? 'expired'
      : error.status === 409 ? 'conflict'
      : error.status >= 500 ? 'unavailable'
      : 'rejected',
    retryable: actionRequired || expired ? false : error.retryable,
    code: error.code,
  }
}

/** Receipt-token control plane. Tokens are header-only and never enter a request body. */
export class HttpOutboundExecutionControl implements OutboundExecutionControl {
  constructor(private readonly http: PlaceTransferHttp) {}

  async consume(input: Parameters<OutboundExecutionControl['consume']>[0]) {
    try {
      const request = outboundExecutionConsumeRequestV2Schema.parse(input.request)
      return outboundExecutionAuthorizationReceiptV2Schema.parse(await this.http.send({
        pathname: '/v2/transfers/outbound-execution-authorizations',
        method: 'POST', body: request, token: input.token, signal: input.signal,
      }))
    } catch (error) { return boundary(error) }
  }

  async prepareAttempt(input: Parameters<OutboundExecutionControl['prepareAttempt']>[0]) {
    try {
      const intent = outboundExecutionAttemptIntentV2Schema.parse(input.intent)
      return outboundExecutionAttemptIntentReceiptV2Schema.parse(await this.http.send({
        pathname: '/v2/transfers/outbound-execution-attempt-intents',
        method: 'POST', body: intent, token: input.receiptToken, signal: input.signal,
      }))
    } catch (error) { return boundary(error) }
  }

  async recordAttempt(input: Parameters<OutboundExecutionControl['recordAttempt']>[0]) {
    try {
      const attempt = outboundExecutionAttemptV2Schema.parse(input.attempt)
      return outboundExecutionAttemptReceiptV2Schema.parse(await this.http.send({
        pathname: '/v2/transfers/outbound-execution-attempts',
        method: 'POST', body: attempt, token: input.receiptToken, signal: input.signal,
      }))
    } catch (error) { return boundary(error) }
  }

  async recordReconciliation(
    input: Parameters<OutboundExecutionControl['recordReconciliation']>[0],
  ) {
    try {
      const reconciliation = outboundExecutionReconciliationV2Schema.parse(input.reconciliation)
      return outboundExecutionReconciliationReceiptV2Schema.parse(await this.http.send({
        pathname: '/v2/transfers/outbound-execution-reconciliations',
        method: 'POST', body: reconciliation,
        token: input.receiptToken, signal: input.signal,
      }))
    } catch (error) { return boundary(error) }
  }
}
