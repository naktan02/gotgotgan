import {
  placeImportBatchDetailQuerySchema,
  placeImportBatchDetailSchema,
  placeImportBatchIdentifierParamsSchema,
  placeImportBatchListQuerySchema,
  placeImportBatchListSchema,
} from '@place/contracts/imports'
import type { FastifyInstance } from 'fastify'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import type { ImportQueries } from '../../application/import-queries.js'
import {
  InvalidImportCursorError,
  InvalidImportQueryError,
} from '../../domain/import-queries.js'
import { importBatchProjection, importItemProjection } from './import-http-projections.js'

export type ImportQueryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  queries: ImportQueries
}>

function queryFailure(
  request: Parameters<typeof sendProductProblem>[0],
  reply: Parameters<typeof sendProductProblem>[1],
  error: unknown,
) {
  if (error instanceof InvalidImportCursorError) {
    return sendProductProblem(
      request, reply, 400, 'PLACE_IMPORT_CURSOR_INVALID', 'Import cursor is invalid',
    )
  }
  if (error instanceof InvalidImportQueryError) {
    return sendProductProblem(
      request, reply, 400, 'PLACE_IMPORT_QUERY_INVALID', 'Import query is invalid',
    )
  }
  return sendProductProblem(
    request, reply, 503, 'PLACE_IMPORT_QUERY_UNAVAILABLE',
    'Import query is temporarily unavailable', true,
  )
}

export function registerImportQueryHttpRoutes(
  application: FastifyInstance,
  dependencies: ImportQueryHttpDependencies,
): void {
  application.get('/v1/imports', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.read',
    )
    if (memberId === undefined) return
    const query = placeImportBatchListQuerySchema.safeParse(request.query)
    if (!query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_QUERY_INVALID', 'Import query is invalid',
      )
    }
    try {
      const page = await dependencies.queries.listBatches({
        memberId,
        state: query.data.state,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      })
      const response = placeImportBatchListSchema.parse({
        ...page,
        items: page.items.map(importBatchProjection),
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/imports/:batchId', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.read',
    )
    if (memberId === undefined) return
    const params = placeImportBatchIdentifierParamsSchema.safeParse(request.params)
    const query = placeImportBatchDetailQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_QUERY_INVALID', 'Import query is invalid',
      )
    }
    try {
      const detail = await dependencies.queries.getBatch({
        memberId,
        batchId: params.data.batchId,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      })
      if (detail === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_IMPORT_NOT_FOUND', 'Import was not found',
        )
      }
      const response = placeImportBatchDetailSchema.parse({
        ...detail,
        batch: importBatchProjection(detail.batch),
        items: detail.items.map(importItemProjection),
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })
}
