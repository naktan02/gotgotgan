import {
  connectorCaptureBatchSchema,
  connectorGrantRequestSchema,
  connectorPublicOriginSchema,
} from '@place/contracts/connector'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import type {
  ConnectorImportReceiver,
  ConnectorReceiverRejection,
} from '../../application/receive-connector-import.js'

export type ConnectorHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  receiver: ConnectorImportReceiver
  maximumCaptureRequestBytes: number
}>

function publicOrigin(request: FastifyRequest): string | undefined {
  const value = request.headers['x-place-public-origin']
  if (typeof value !== 'string') return undefined
  return connectorPublicOriginSchema.safeParse(value).data
}

function connectorToken(request: FastifyRequest): string | undefined {
  return /^PlaceConnector ([A-Za-z0-9._~-]{32,8192})$/.exec(
    request.headers.authorization ?? '',
  )?.[1]
}

function sendConnectorRejection(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: ConnectorReceiverRejection | 'operation-conflict',
) {
  if (reason === 'invalid-grant' || reason === 'grant-expired') {
    return sendProductProblem(
      request, reply, 401, 'PLACE_CONNECTOR_GRANT_INVALID', 'Connector grant is invalid',
      false, 'PlaceConnector',
    )
  }
  if (reason === 'origin-mismatch') {
    return sendProductProblem(
      request, reply, 403, 'PLACE_CONNECTOR_ORIGIN_DENIED', 'Connector origin is not allowed',
    )
  }
  if (reason === 'operation-conflict') {
    return sendProductProblem(
      request, reply, 409, 'PLACE_CONNECTOR_OPERATION_CONFLICT',
      'Connector operation conflicts with persisted state',
    )
  }
  return sendProductProblem(
    request, reply, 400,
    reason === 'limit-exceeded' ? 'PLACE_CONNECTOR_LIMIT_EXCEEDED' : 'PLACE_CONNECTOR_CAPTURE_INVALID',
    reason === 'limit-exceeded'
      ? 'Connector capture exceeded its grant limits'
      : 'Connector capture is invalid',
  )
}

export function registerConnectorHttpRoutes(
  application: FastifyInstance,
  dependencies: ConnectorHttpDependencies,
): void {
  if (
    !Number.isInteger(dependencies.maximumCaptureRequestBytes) ||
    dependencies.maximumCaptureRequestBytes < 1_024 ||
    dependencies.maximumCaptureRequestBytes > 8_454_144
  ) throw new Error('Connector HTTP configuration is invalid')
  application.post('/v1/connector-grants', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    const origin = publicOrigin(request)
    const body = connectorGrantRequestSchema.safeParse(request.body)
    if (origin === undefined || !body.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_CONNECTOR_GRANT_REQUEST_INVALID',
        'Connector grant request is invalid',
      )
    }
    const result = await dependencies.receiver.issueGrant({
      memberId,
      publicOrigin: origin,
      request: body.data,
    })
    if (result.status === 'rejected') {
      return sendConnectorRejection(request, reply, result.reason)
    }
    return reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .status(result.status === 'created' ? 201 : 200)
      .send(result.grant)
  })

  application.post('/v1/connector-captures', {
    bodyLimit: dependencies.maximumCaptureRequestBytes,
  }, async (request, reply) => {
    const token = connectorToken(request)
    if (token === undefined) {
      return sendProductProblem(
        request, reply, 401, 'PLACE_CONNECTOR_GRANT_INVALID',
        'Connector grant is invalid', false, 'PlaceConnector',
      )
    }
    const origin = publicOrigin(request)
    const body = connectorCaptureBatchSchema.safeParse(request.body)
    if (origin === undefined || !body.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_CONNECTOR_CAPTURE_REQUEST_INVALID',
        'Connector capture request is invalid',
      )
    }
    const result = await dependencies.receiver.submitCapture({
      token,
      publicOrigin: origin,
      batch: body.data,
    })
    if (result.status === 'rejected') {
      return sendConnectorRejection(request, reply, result.reason)
    }
    return reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .status(result.status === 'accepted' ? 202 : 200)
      .send(result.receipt)
  })
}
