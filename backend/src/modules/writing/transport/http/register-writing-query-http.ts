import {
  writingDetailResponseSchema,
  writingDocumentIdentifierParamsSchema,
  writingListQuerySchema,
  writingListResponseSchema,
} from '@place/contracts/writing'
import type { FastifyInstance } from 'fastify'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import type { WritingQueries } from '../../application/writing-queries.js'
import {
  InvalidWritingCursorError,
  InvalidWritingQueryError,
} from '../../domain/queries.js'

export type WritingQueryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  queries: WritingQueries
}>

function queryFailure(
  request: Parameters<typeof sendProductProblem>[0],
  reply: Parameters<typeof sendProductProblem>[1],
  error: unknown,
) {
  return error instanceof InvalidWritingCursorError || error instanceof InvalidWritingQueryError
    ? sendProductProblem(
        request, reply, 400, 'PLACE_WRITING_CURSOR_INVALID', 'Writing cursor is invalid',
      )
    : sendProductProblem(
        request, reply, 503, 'PLACE_WRITING_QUERY_UNAVAILABLE',
        'Writing query is temporarily unavailable', true,
      )
}

export function registerWritingQueryHttpRoutes(
  application: FastifyInstance,
  dependencies: WritingQueryHttpDependencies,
): void {
  application.get('/v1/writing', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const query = writingListQuerySchema.safeParse(request.query)
    if (!query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_WRITING_QUERY_INVALID', 'Writing query is invalid',
      )
    }
    try {
      const response = writingListResponseSchema.parse(await dependencies.queries.list({
        memberId,
        kind: query.data.kind,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      }))
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/writing/:documentId', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const params = writingDocumentIdentifierParamsSchema.safeParse(request.params)
    if (!params.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_WRITING_QUERY_INVALID', 'Writing query is invalid',
      )
    }
    try {
      const detail = await dependencies.queries.get({
        memberId,
        documentId: params.data.documentId,
      })
      if (detail === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_WRITING_NOT_FOUND', 'Writing not found',
        )
      }
      const response = writingDetailResponseSchema.parse(detail)
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })
}
