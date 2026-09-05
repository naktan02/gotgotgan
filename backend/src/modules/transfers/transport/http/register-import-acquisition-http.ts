import {
  importAcquisitionCommandResultV1Schema,
  importAcquisitionCommandV1Schema,
  importAcquisitionIdentifierParamsV1Schema,
  importAcquisitionV1Schema,
  startImportAcquisitionV1Schema,
} from '@place/contracts/transfers'
import type { FastifyInstance } from 'fastify'

import type { ImportAcquisitions } from '../../domain/acquisitions.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type ImportAcquisitionHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  acquisitions: ImportAcquisitions
  remoteBrowserEnabled?: boolean
}>

function rejectionStatus(code: string): 404 | 409 | 422 | 429 {
  if (code === 'not-found') return 404
  if (code === 'not-cancellable') return 422
  if (code === 'limit-exceeded') return 429
  return 409
}

export function registerImportAcquisitionHttpRoutes(
  application: FastifyInstance,
  dependencies: ImportAcquisitionHttpDependencies,
): void {
  application.post('/v1/transfers/import-acquisitions', async (request, reply) => {
    const parsed = startImportAcquisitionV1Schema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_ACQUISITION_V1_REQUEST_INVALID',
        'Import acquisition request is invalid',
      )
    }
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    if (parsed.data.kind === 'remote-browser' && dependencies.remoteBrowserEnabled !== true) {
      return sendProductProblem(
        request, reply, 503, 'PLACE_IMPORT_ACQUISITION_REMOTE_BROWSER_DISABLED',
        'Remote browser import is unavailable',
      )
    }
    try {
      const result = await dependencies.acquisitions.start(memberId, parsed.data)
      const response = importAcquisitionCommandResultV1Schema.parse(result)
      return reply.header('cache-control', 'no-store').status(
        result.outcome === 'rejected'
          ? rejectionStatus(result.rejection.code)
          : result.status === 'applied' ? 201 : 200,
      ).send(response)
    } catch {
      return sendProductProblem(
        request, reply, 503, 'PLACE_IMPORT_ACQUISITION_V1_UNAVAILABLE',
        'Import acquisition is temporarily unavailable', true,
      )
    }
  })

  application.get('/v1/transfers/import-acquisitions/:acquisitionId', async (request, reply) => {
    const parsed = importAcquisitionIdentifierParamsV1Schema.safeParse(request.params)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_ACQUISITION_V1_REQUEST_INVALID',
        'Import acquisition identifier is invalid',
      )
    }
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.read',
    )
    if (memberId === undefined) return
    try {
      const acquisition = await dependencies.acquisitions.get(
        memberId, parsed.data.acquisitionId,
      )
      if (acquisition === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_TRANSFER_RESOURCE_NOT_FOUND',
          'Transfer resource not found',
        )
      }
      return reply.header('cache-control', 'no-store').status(200)
        .send(importAcquisitionV1Schema.parse(acquisition))
    } catch {
      return sendProductProblem(
        request, reply, 503, 'PLACE_IMPORT_ACQUISITION_V1_UNAVAILABLE',
        'Import acquisition is temporarily unavailable', true,
      )
    }
  })

  application.post('/v1/transfers/import-acquisition-commands', async (request, reply) => {
    const parsed = importAcquisitionCommandV1Schema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_ACQUISITION_V1_REQUEST_INVALID',
        'Import acquisition command is invalid',
      )
    }
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    try {
      const result = await dependencies.acquisitions.applyCommand(memberId, parsed.data)
      return reply.header('cache-control', 'no-store').status(
        result.outcome === 'rejected' ? rejectionStatus(result.rejection.code) : 200,
      ).send(importAcquisitionCommandResultV1Schema.parse(result))
    } catch {
      return sendProductProblem(
        request, reply, 503, 'PLACE_IMPORT_ACQUISITION_V1_UNAVAILABLE',
        'Import acquisition is temporarily unavailable', true,
      )
    }
  })
}
