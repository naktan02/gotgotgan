import {
  connectorCaptureChunkReceiptV2Schema,
  connectorCaptureChunkV2Schema,
  connectorCaptureCompleteRequestV2Schema,
  connectorCaptureCompleteResultV2Schema,
  connectorCaptureManifestStatusV2Schema,
  connectorImportGrantRequestV2Schema,
  connectorImportGrantResultV2Schema,
} from '@place/contracts/transfers'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { ConnectorTransferReceiver } from '../../domain/operations.js'
import { ConnectorTransferAuthorizationError } from '../../domain/operations.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

const captureParams = z.object({ operationId: z.uuid(), manifestId: z.uuid() }).strict()

export type ConnectorTransferHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  receiver: ConnectorTransferReceiver
  maximumCaptureRequestBytes: number
}>

function connectorToken(request: FastifyRequest): string | undefined {
  return /^PlaceConnector ([A-Za-z0-9_-]{32,512})$/.exec(request.headers.authorization ?? '')?.[1]
}

function origin(request: FastifyRequest): string | undefined {
  const value = request.headers.origin
  return Array.isArray(value) ? undefined : value
}

async function withConnectorAuthorization<T>(
  request: FastifyRequest,
  reply: Parameters<typeof sendProductProblem>[1],
  work: (token: string, sourceOrigin: string) => Promise<T>,
): Promise<T | undefined> {
  const token = connectorToken(request)
  const sourceOrigin = origin(request)
  if (token === undefined || sourceOrigin === undefined) {
    sendProductProblem(request, reply, 401, 'PLACE_CONNECTOR_AUTHORIZATION_REQUIRED',
      'A connector authorization and exact Origin are required')
    return undefined
  }
  try {
    return await work(token, sourceOrigin)
  } catch (error) {
    if (error instanceof ConnectorTransferAuthorizationError) {
      sendProductProblem(request, reply, 401, 'PLACE_CONNECTOR_AUTHORIZATION_INVALID',
        'Connector authorization is invalid or expired')
      return undefined
    }
    throw error
  }
}

export function registerConnectorTransferHttpRoutes(
  application: FastifyInstance,
  dependencies: ConnectorTransferHttpDependencies,
): void {
  application.post('/v2/transfers/connector-import-grants', async (request, reply) => {
    const parsed = connectorImportGrantRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400,
      'PLACE_CONNECTOR_GRANT_REQUEST_INVALID', 'Connector grant request is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.write')
    if (memberId === undefined) return
    const result = await dependencies.receiver.issueImportGrant(memberId, parsed.data)
    const response = result.status === 'rejected'
      ? { schemaVersion: 'connector-import-grant-result.v2' as const, outcome: 'rejected' as const,
          commandId: result.commandId, rejection: result.rejection }
      : { schemaVersion: 'connector-import-grant-result.v2' as const, outcome: 'accepted' as const,
          commandId: result.commandId, status: result.status,
          grant: { schemaVersion: 'connector-import-grant.v2' as const,
            operation: 'import-saved-library' as const, ...result.value } }
    return reply.header('cache-control', 'no-store').status(result.status === 'rejected' ? 409 : 200)
      .send(connectorImportGrantResultV2Schema.parse(response))
  })

  application.post('/v2/transfers/connector-captures/:operationId/:manifestId/chunks', {
    bodyLimit: dependencies.maximumCaptureRequestBytes,
  },
    async (request, reply) => {
      const params = captureParams.safeParse(request.params)
      const body = connectorCaptureChunkV2Schema.safeParse(request.body)
      if (!params.success || !body.success || body.data.operationId !== params.data.operationId ||
        body.data.manifestId !== params.data.manifestId) return sendProductProblem(request, reply, 400,
        'PLACE_CONNECTOR_CAPTURE_REQUEST_INVALID', 'Capture chunk binding is invalid')
      const result = await withConnectorAuthorization(request, reply, (token, sourceOrigin) =>
        dependencies.receiver.recordChunk({ token, sourceOrigin, chunk: body.data }))
      if (result === undefined) return
      return reply.header('cache-control', 'no-store').send(connectorCaptureChunkReceiptV2Schema.parse({
        schemaVersion: 'connector-capture-chunk-receipt.v2', ...result,
      }))
    })

  application.get('/v2/transfers/connector-captures/:operationId/:manifestId', async (request, reply) => {
    const params = captureParams.safeParse(request.params)
    if (!params.success) return sendProductProblem(request, reply, 400,
      'PLACE_CONNECTOR_CAPTURE_REQUEST_INVALID', 'Capture binding is invalid')
    const result = await withConnectorAuthorization(request, reply, (token, sourceOrigin) =>
      dependencies.receiver.status({ token, sourceOrigin, ...params.data }))
    if (result === undefined) return
    return reply.header('cache-control', 'no-store').send(connectorCaptureManifestStatusV2Schema.parse({
      schemaVersion: 'connector-capture-manifest-status.v2', ...result,
    }))
  })

  application.post('/v2/transfers/connector-captures/:operationId/:manifestId/complete',
    async (request, reply) => {
      const params = captureParams.safeParse(request.params)
      const body = connectorCaptureCompleteRequestV2Schema.safeParse(request.body)
      if (!params.success || !body.success || body.data.operationId !== params.data.operationId ||
        body.data.manifest.manifestId !== params.data.manifestId) return sendProductProblem(request, reply, 400,
        'PLACE_CONNECTOR_CAPTURE_REQUEST_INVALID', 'Capture completion binding is invalid')
      const result = await withConnectorAuthorization(request, reply, (token, sourceOrigin) =>
        dependencies.receiver.complete({ token, sourceOrigin, ...body.data }))
      if (result === undefined) return
      return reply.header('cache-control', 'no-store').send(connectorCaptureCompleteResultV2Schema.parse({
        schemaVersion: 'connector-capture-complete-result.v2', ...result,
      }))
    })
}
