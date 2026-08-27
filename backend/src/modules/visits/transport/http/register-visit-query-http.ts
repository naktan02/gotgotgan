import {
  visitHistoryQuerySchema,
  visitHistoryResponseSchema,
} from '@place/contracts/visits'
import { placeIdentifierParamsSchema } from '@place/contracts/http'
import type { FastifyInstance } from 'fastify'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import type { VisitQueries } from '../../application/visit-queries.js'
import {
  InvalidVisitCursorError,
  InvalidVisitQueryError,
} from '../../domain/queries.js'

export type VisitQueryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  queries: VisitQueries
}>

export function registerVisitQueryHttpRoutes(
  application: FastifyInstance,
  dependencies: VisitQueryHttpDependencies,
): void {
  application.get('/v1/places/:placeId/visits', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const params = placeIdentifierParamsSchema.safeParse(request.params)
    const query = visitHistoryQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_VISIT_QUERY_INVALID', 'Visit query is invalid',
      )
    }
    try {
      const response = visitHistoryResponseSchema.parse(
        await dependencies.queries.listPlaceVisits({
          memberId,
          placeId: params.data.placeId,
          limit: query.data.limit,
          ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        }),
      )
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return error instanceof InvalidVisitCursorError || error instanceof InvalidVisitQueryError
        ? sendProductProblem(
            request, reply, 400, 'PLACE_VISIT_CURSOR_INVALID', 'Visit cursor is invalid',
          )
        : sendProductProblem(
            request, reply, 503, 'PLACE_VISIT_QUERY_UNAVAILABLE',
            'Visit history is temporarily unavailable', true,
          )
    }
  })
}
