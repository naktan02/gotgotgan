import {
  accountErasureReviewCommandRequestV2Schema,
  accountErasureReviewCommandResultV2Schema,
  transferOperationCommandRequestV2Schema,
  transferOperationCommandResultV2Schema,
  transferOperationIdentifierParamsV2Schema,
  transferOperationItemPageV2Schema,
  transferOperationItemQueryV2Schema,
  transferOperationListQueryV2Schema,
  transferOperationListV2Schema,
  transferOperationSummaryV2Schema,
  transferOperationV2Schema,
} from '@place/contracts/transfers'
import type { FastifyInstance } from 'fastify'

import type { TransferOperationQueries } from '../../domain/operations.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type TransferOperationHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  operations: TransferOperationQueries
}>

export function registerTransferOperationHttpRoutes(
  application: FastifyInstance,
  dependencies: TransferOperationHttpDependencies,
): void {
  application.get('/v2/operations', async (request, reply) => {
    const query = transferOperationListQueryV2Schema.safeParse(request.query)
    if (!query.success) return sendProductProblem(request, reply, 400,
      'PLACE_TRANSFER_OPERATION_REQUEST_INVALID', 'Operation query is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.read')
    if (memberId === undefined) return
    const page = await dependencies.operations.list({
      memberId, limit: query.data.limit,
      ...(query.data.kind === undefined ? {} : { kind: query.data.kind }),
      ...(query.data.state === undefined ? {} : { state: query.data.state }),
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
    })
    return reply.header('cache-control', 'no-store').send(transferOperationListV2Schema.parse({
      schemaVersion: 'transfer-operation-list.v2', ...page,
    }))
  })

  application.get('/v2/operations/summary', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.read')
    if (memberId === undefined) return
    return reply.header('cache-control', 'no-store').send(transferOperationSummaryV2Schema.parse({
      schemaVersion: 'transfer-operation-summary.v2',
      ...await dependencies.operations.summary(memberId),
    }))
  })

  application.get('/v2/operations/:operationId', async (request, reply) => {
    const params = transferOperationIdentifierParamsV2Schema.safeParse(request.params)
    if (!params.success) return sendProductProblem(request, reply, 400,
      'PLACE_TRANSFER_OPERATION_REQUEST_INVALID', 'Operation identifier is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.read')
    if (memberId === undefined) return
    const value = await dependencies.operations.get(memberId, params.data.operationId)
    if (value === undefined) return sendProductProblem(request, reply, 404,
      'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
    return reply.header('cache-control', 'no-store').send(transferOperationV2Schema.parse(value))
  })

  application.get('/v2/operations/:operationId/items', async (request, reply) => {
    const params = transferOperationIdentifierParamsV2Schema.safeParse(request.params)
    const query = transferOperationItemQueryV2Schema.safeParse(request.query)
    if (!params.success || !query.success) return sendProductProblem(request, reply, 400,
      'PLACE_TRANSFER_OPERATION_REQUEST_INVALID', 'Operation item query is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.read')
    if (memberId === undefined) return
    const page = await dependencies.operations.items({
      memberId, operationId: params.data.operationId, limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
    })
    if (page === undefined) return sendProductProblem(request, reply, 404,
      'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
    return reply.header('cache-control', 'no-store').send(transferOperationItemPageV2Schema.parse({
      schemaVersion: 'transfer-operation-item-page.v2', operationId: params.data.operationId, ...page,
    }))
  })

  application.post('/v2/operation-commands', async (request, reply) => {
    const parsed = transferOperationCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400,
      'PLACE_TRANSFER_OPERATION_REQUEST_INVALID', 'Operation command is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.write')
    if (memberId === undefined) return
    const result = await dependencies.operations.command(memberId, parsed.data)
    const response = result.status === 'rejected'
      ? { schemaVersion: 'transfer-operation-command-result.v2' as const, outcome: 'rejected' as const,
          commandId: result.commandId, rejection: result.rejection }
      : { schemaVersion: 'transfer-operation-command-result.v2' as const, outcome: 'accepted' as const,
          commandId: result.commandId, status: result.status, operation: result.value }
    const status = result.status !== 'rejected' ? 200
      : result.rejection.code === 'not-found' ? 404
        : result.rejection.code === 'revision-conflict' || result.rejection.code === 'command-id-reused'
          ? 409 : 422
    return reply.header('cache-control', 'no-store').status(status)
      .send(transferOperationCommandResultV2Schema.parse(response))
  })

  application.post('/v2/transfers/account-erasure-review-commands', async (request, reply) => {
    const parsed = accountErasureReviewCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400,
      'PLACE_TRANSFER_OPERATION_REQUEST_INVALID', 'Account erasure review command is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'transfers.write')
    if (memberId === undefined) return
    const result = await dependencies.operations.planAccountErasure(memberId, parsed.data.commandId)
    const response = result.status === 'rejected'
      ? { schemaVersion: 'account-erasure-review-command-result.v2' as const,
          outcome: 'rejected' as const, commandId: result.commandId, rejection: result.rejection }
      : { schemaVersion: 'account-erasure-review-command-result.v2' as const,
          outcome: 'accepted' as const, commandId: result.commandId, status: result.status,
          operation: result.value.operation, plan: result.value.plan }
    return reply.header('cache-control', 'no-store').status(result.status === 'rejected' ? 409 : 200)
      .send(accountErasureReviewCommandResultV2Schema.parse(response))
  })
}
