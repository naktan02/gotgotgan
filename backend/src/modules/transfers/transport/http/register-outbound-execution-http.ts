import {
  outboundExecutionAttemptReceiptV2Schema,
  outboundExecutionAttemptIntentReceiptV2Schema,
  outboundExecutionAttemptIntentV2Schema,
  outboundExecutionAttemptV2Schema,
  outboundExecutionAuthorizationReceiptV2Schema,
  outboundExecutionConsumeRequestV2Schema,
  outboundExecutionGrantRequestV2Schema,
  outboundExecutionGrantResultV2Schema,
  outboundExecutionReconciliationReceiptV2Schema,
  outboundExecutionReconciliationV2Schema,
} from '@place/contracts/transfers'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  ConnectorTransferAuthorizationError,
  type OutboundExecutionControl,
} from '../../domain/operations.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type OutboundExecutionHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  control: OutboundExecutionControl
}>

function capability(request: FastifyRequest): { token: string; origin: string } | undefined {
  const token = /^PlaceConnector ([A-Za-z0-9_-]{32,512})$/.exec(
    request.headers.authorization ?? '',
  )?.[1]
  const header = request.headers.origin
  const origin = Array.isArray(header) ? undefined : header
  return token === undefined || origin === undefined ? undefined : { token, origin }
}

async function externallyAuthorized<T>(request: FastifyRequest, reply: FastifyReply,
  work: (value: { token: string; origin: string }) => Promise<T>): Promise<T | undefined> {
  const value = capability(request)
  if (value === undefined) {
    sendProductProblem(request, reply, 401, 'PLACE_CONNECTOR_AUTHORIZATION_REQUIRED',
      'A connector authorization and exact Origin are required')
    return undefined
  }
  try { return await work(value) } catch (error) {
    if (error instanceof ConnectorTransferAuthorizationError) {
      sendProductProblem(request, reply, 401, 'PLACE_CONNECTOR_AUTHORIZATION_INVALID',
        'Connector authorization is invalid or expired')
      return undefined
    }
    throw error
  }
}

export function registerOutboundExecutionHttpRoutes(
  application: FastifyInstance,
  dependencies: OutboundExecutionHttpDependencies,
): void {
  application.post('/v2/transfers/outbound-execution-grants', async (request, reply) => {
    const body = outboundExecutionGrantRequestV2Schema.safeParse(request.body)
    if (!body.success) return sendProductProblem(request, reply, 400,
      'PLACE_OUTBOUND_EXECUTION_REQUEST_INVALID', 'Outbound execution grant is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.write')
    if (memberId === undefined) return
    const result = await dependencies.control.issueGrant(memberId, body.data)
    const response = result.status === 'rejected'
      ? { schemaVersion: 'outbound-execution-grant-result.v2' as const, outcome: 'rejected' as const,
          commandId: result.commandId, rejection: result.rejection }
      : { schemaVersion: 'outbound-execution-grant-result.v2' as const, outcome: 'accepted' as const,
          commandId: result.commandId, status: result.status,
          grant: { schemaVersion: 'outbound-execution-grant.v2' as const,
            operation: 'export-saved-library' as const, ...result.value,
            manifest: { schemaVersion: 'outbound-execution-manifest.v2' as const,
              ...result.value.manifest } } }
    return reply.header('cache-control', 'no-store').status(result.status === 'rejected' ? 409 : 200)
      .send(outboundExecutionGrantResultV2Schema.parse(response))
  })

  application.post('/v2/transfers/outbound-execution-authorizations', async (request, reply) => {
    const body = outboundExecutionConsumeRequestV2Schema.safeParse(request.body)
    if (!body.success) return sendProductProblem(request, reply, 400,
      'PLACE_OUTBOUND_EXECUTION_REQUEST_INVALID', 'Execution authorization request is invalid')
    const result = await externallyAuthorized(request, reply, ({ token, origin }) =>
      dependencies.control.consume({ token, request: { ...body.data, sourceOrigin: origin } }))
    if (result === undefined) return
    return reply.header('cache-control', 'no-store').send(
      outboundExecutionAuthorizationReceiptV2Schema.parse({
        schemaVersion: 'outbound-execution-authorization-receipt.v2', ...result,
      }),
    )
  })

  application.post('/v2/transfers/outbound-execution-attempts', async (request, reply) => {
    const body = outboundExecutionAttemptV2Schema.safeParse(request.body)
    if (!body.success) return sendProductProblem(request, reply, 400,
      'PLACE_OUTBOUND_EXECUTION_REQUEST_INVALID', 'Execution attempt is invalid')
    const result = await externallyAuthorized(request, reply, ({ token, origin }) =>
      dependencies.control.recordAttempt({ receiptToken: token, sourceOrigin: origin,
        attempt: body.data }))
    if (result === undefined) return
    return reply.header('cache-control', 'no-store').send(
      outboundExecutionAttemptReceiptV2Schema.parse({
        schemaVersion: 'outbound-execution-attempt-receipt.v2', ...result,
      }),
    )
  })

  application.post('/v2/transfers/outbound-execution-attempt-intents', async (request, reply) => {
    const body = outboundExecutionAttemptIntentV2Schema.safeParse(request.body)
    if (!body.success) return sendProductProblem(request, reply, 400,
      'PLACE_OUTBOUND_EXECUTION_REQUEST_INVALID', 'Execution attempt intent is invalid')
    const result = await externallyAuthorized(request, reply, ({ token, origin }) =>
      dependencies.control.prepareAttempt({ receiptToken: token, sourceOrigin: origin,
        intent: body.data }))
    if (result === undefined) return
    return reply.header('cache-control', 'no-store').send(
      outboundExecutionAttemptIntentReceiptV2Schema.parse({
        schemaVersion: 'outbound-execution-attempt-intent-receipt.v2', ...result,
      }),
    )
  })

  application.post('/v2/transfers/outbound-execution-reconciliations', async (request, reply) => {
    const body = outboundExecutionReconciliationV2Schema.safeParse(request.body)
    if (!body.success) return sendProductProblem(request, reply, 400,
      'PLACE_OUTBOUND_EXECUTION_REQUEST_INVALID', 'Execution reconciliation is invalid')
    const result = await externallyAuthorized(request, reply, ({ token, origin }) =>
      dependencies.control.recordReconciliation({ receiptToken: token, sourceOrigin: origin,
        reconciliation: body.data }))
    if (result === undefined) return
    return reply.header('cache-control', 'no-store').send(
      outboundExecutionReconciliationReceiptV2Schema.parse({
        schemaVersion: 'outbound-execution-reconciliation-receipt.v2', ...result,
      }),
    )
  })
}
