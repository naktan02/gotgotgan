import {
  importPlanCommandRequestV2Schema,
  importPlanCommandResultV2Schema,
  importPlanCommandRequestV3Schema,
  importPlanCommandResultV3Schema,
  importPlanIdentifierParamsV2Schema,
  importPlanIdentifierParamsV3Schema,
  importPlanV2Schema,
  importPlanV3Schema,
  outboundTransferCommandRequestV2Schema,
  outboundTransferCommandResultV2Schema,
  outboundTransferIdentifierParamsV2Schema,
  outboundTransferV2Schema,
  providerCapabilityListV2Schema,
  providerConnectionCommandRequestV2Schema,
  providerConnectionCommandResultV2Schema,
  providerConnectionIdentifierParamsV2Schema,
  providerConnectionListV2Schema,
  providerTargetListProjectionV2Schema,
  sourceSnapshotDetailV2Schema,
  sourceSnapshotIdentifierParamsV2Schema,
  sourceSnapshotListQueryV2Schema,
  sourceSnapshotListV2Schema,
  type TransferCommandRejectionCodeV2,
} from '@place/contracts/transfers'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  InvalidTransferCursorError,
  type ProviderTransfers,
  type TransferCommandResult,
} from '../../domain/model.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type ProviderTransferHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  transfers: ProviderTransfers
}>

function invalid(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  contractMajor: 2 | 3 = 2,
) {
  return sendProductProblem(
    request, reply, 400, `PLACE_TRANSFER_V${contractMajor}_REQUEST_INVALID`, message,
  )
}

function unavailable(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  contractMajor: 2 | 3 = 2,
) {
  if (error instanceof InvalidTransferCursorError) {
    return invalid(request, reply, 'Provider transfer cursor is invalid', contractMajor)
  }
  return sendProductProblem(
    request, reply, 503, `PLACE_TRANSFER_V${contractMajor}_UNAVAILABLE`,
    'Provider transfer capability is temporarily unavailable', true,
  )
}

function rejectionStatus(code: TransferCommandRejectionCodeV2): 404 | 409 | 422 {
  if (code === 'not-found') return 404
  if (
    code === 'command-id-reused' || code === 'revision-conflict' ||
    code === 'snapshot-changed' || code === 'collection-changed' ||
    code === 'target-observation-changed'
  ) return 409
  return 422
}

function commandStatus<Value>(result: TransferCommandResult<Value>): 200 | 201 | 404 | 409 | 422 {
  if (result.status === 'rejected') return rejectionStatus(result.rejection.code)
  return result.status === 'applied' ? 201 : 200
}

export function registerProviderTransferHttpRoutes(
  application: FastifyInstance,
  dependencies: ProviderTransferHttpDependencies,
): void {
  application.get('/v2/transfers/provider-capabilities', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.read')
    if (memberId === undefined) return
    try {
      const response = providerCapabilityListV2Schema.parse({
        schemaVersion: 'provider-capability-list.v2',
        items: await dependencies.transfers.listCapabilities(),
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v2/transfers/provider-connections', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.read')
    if (memberId === undefined) return
    try {
      const response = providerConnectionListV2Schema.parse({
        schemaVersion: 'provider-connection-list.v2',
        items: await dependencies.transfers.listConnections(memberId),
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v2/transfers/provider-connection-commands', async (request, reply) => {
    const parsed = providerConnectionCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Provider connection command is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.write')
    if (memberId === undefined) return
    try {
      const result = await dependencies.transfers.applyConnectionCommand(memberId, parsed.data)
      const response = result.status === 'rejected'
        ? providerConnectionCommandResultV2Schema.parse({
            schemaVersion: 'provider-connection-command-result.v2', outcome: 'rejected',
            commandId: result.commandId, rejection: result.rejection,
          })
        : providerConnectionCommandResultV2Schema.parse({
            schemaVersion: 'provider-connection-command-result.v2', outcome: 'accepted',
            commandId: result.commandId, status: result.status, connection: result.value,
          })
      return reply.header('cache-control', 'no-store').status(commandStatus(result)).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v2/transfers/source-snapshots', async (request, reply) => {
    const parsed = sourceSnapshotListQueryV2Schema.safeParse(request.query)
    if (!parsed.success) return invalid(request, reply, 'Source snapshot query is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.read')
    if (memberId === undefined) return
    try {
      const response = sourceSnapshotListV2Schema.parse(await dependencies.transfers.listSnapshots({
        memberId,
        ...(parsed.data.connectionId === undefined ? {} : { connectionId: parsed.data.connectionId }),
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        limit: parsed.data.limit,
      }))
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v2/transfers/source-snapshots/:snapshotId', async (request, reply) => {
    const params = sourceSnapshotIdentifierParamsV2Schema.safeParse(request.params)
    if (!params.success) return invalid(request, reply, 'Source snapshot identifier is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.read')
    if (memberId === undefined) return
    try {
      const snapshot = await dependencies.transfers.getSnapshot(memberId, params.data.snapshotId)
      if (snapshot === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
      }
      return reply.header('cache-control', 'no-store').status(200)
        .send(sourceSnapshotDetailV2Schema.parse(snapshot))
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v2/transfers/import-plan-commands', async (request, reply) => {
    const parsed = importPlanCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Import plan command is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.write')
    if (memberId === undefined) return
    try {
      const result = await dependencies.transfers.applyImportPlanCommandV2(memberId, parsed.data)
      const response = result.status === 'rejected'
        ? importPlanCommandResultV2Schema.parse({
            schemaVersion: 'import-plan-command-result.v2', outcome: 'rejected',
            commandId: result.commandId, rejection: result.rejection,
          })
        : importPlanCommandResultV2Schema.parse({
            schemaVersion: 'import-plan-command-result.v2', outcome: 'accepted',
            commandId: result.commandId, status: result.status, plan: result.value,
          })
      return reply.header('cache-control', 'no-store').status(commandStatus(result)).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v2/transfers/import-plans/:planId', async (request, reply) => {
    const params = importPlanIdentifierParamsV2Schema.safeParse(request.params)
    if (!params.success) return invalid(request, reply, 'Import plan identifier is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'imports.read')
    if (memberId === undefined) return
    try {
      const plan = await dependencies.transfers.getImportPlanV2(memberId, params.data.planId)
      if (plan === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
      }
      return reply.header('cache-control', 'no-store').status(200).send(importPlanV2Schema.parse(plan))
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v3/transfers/import-plan-commands', async (request, reply) => {
    const parsed = importPlanCommandRequestV3Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Import plan command is invalid', 3)
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    try {
      const result = await dependencies.transfers.applyImportPlanCommandV3(memberId, parsed.data)
      const response = result.status === 'rejected'
        ? importPlanCommandResultV3Schema.parse({
            schemaVersion: 'import-plan-command-result.v3', outcome: 'rejected',
            commandId: result.commandId, rejection: result.rejection,
          })
        : importPlanCommandResultV3Schema.parse({
            schemaVersion: 'import-plan-command-result.v3', outcome: 'accepted',
            commandId: result.commandId, status: result.status, plan: result.value,
          })
      return reply.header('cache-control', 'no-store').status(commandStatus(result)).send(response)
    } catch (error) {
      return unavailable(request, reply, error, 3)
    }
  })

  application.get('/v3/transfers/import-plans/:planId', async (request, reply) => {
    const params = importPlanIdentifierParamsV3Schema.safeParse(request.params)
    if (!params.success) return invalid(request, reply, 'Import plan identifier is invalid', 3)
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.read',
    )
    if (memberId === undefined) return
    try {
      const plan = await dependencies.transfers.getImportPlanV3(memberId, params.data.planId)
      if (plan === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND',
          'Transfer resource not found',
        )
      }
      return reply.header('cache-control', 'no-store').status(200).send(importPlanV3Schema.parse(plan))
    } catch (error) {
      return unavailable(request, reply, error, 3)
    }
  })

  application.get('/v2/transfers/provider-connections/:connectionId/target-lists', async (request, reply) => {
    const params = providerConnectionIdentifierParamsV2Schema.safeParse(request.params)
    if (!params.success) return invalid(request, reply, 'Provider connection identifier is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    try {
      const projection = await dependencies.transfers.listTargetLists(memberId, params.data.connectionId)
      if (projection === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
      }
      return reply.header('cache-control', 'no-store').status(200).send(
        providerTargetListProjectionV2Schema.parse({
          schemaVersion: 'provider-target-list-projection.v2', ...projection,
        }),
      )
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v2/transfers/outbound-transfer-commands', async (request, reply) => {
    const parsed = outboundTransferCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Outbound transfer command is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.write')
    if (memberId === undefined) return
    try {
      const result = await dependencies.transfers.applyOutboundTransferCommand(memberId, parsed.data)
      const response = result.status === 'rejected'
        ? outboundTransferCommandResultV2Schema.parse({
            schemaVersion: 'outbound-transfer-command-result.v2', outcome: 'rejected',
            commandId: result.commandId, rejection: result.rejection,
          })
        : outboundTransferCommandResultV2Schema.parse({
            schemaVersion: 'outbound-transfer-command-result.v2', outcome: 'accepted',
            commandId: result.commandId, status: result.status, transfer: result.value,
          })
      return reply.header('cache-control', 'no-store').status(commandStatus(result)).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v2/transfers/outbound-transfers/:transferId', async (request, reply) => {
    const params = outboundTransferIdentifierParamsV2Schema.safeParse(request.params)
    if (!params.success) return invalid(request, reply, 'Outbound transfer identifier is invalid')
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    try {
      const transfer = await dependencies.transfers.getOutboundTransfer(memberId, params.data.transferId)
      if (transfer === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND', 'Transfer resource not found')
      }
      return reply.header('cache-control', 'no-store').status(200).send(outboundTransferV2Schema.parse(transfer))
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })
}
