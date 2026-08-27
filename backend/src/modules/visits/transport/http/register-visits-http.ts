import type { FastifyInstance } from 'fastify'
import {
  placeIdentifierParamsSchema,
  visitRecordRequestSchema,
} from '@place/contracts/http'
import {
  visitRecordResultSchema,
  visitSummaryResponseSchema,
} from '@place/contracts/visits'

import { requireProductMember, sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import type { VisitStore } from '../../application/ports/visit-store.js'
import type { VisitQueries } from '../../application/visit-queries.js'
import { recordVisit } from '../../application/record-visit.js'
import { VisitIdConflictError } from '../../domain/model.js'
import { registerVisitQueryHttpRoutes } from './register-visit-query-http.js'

export type VisitsHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: VisitStore
  queries: VisitQueries
  now: () => Date
}>

export function registerVisitsHttpRoutes(application: FastifyInstance, dependencies: VisitsHttpDependencies): void {
  registerVisitQueryHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    queries: dependencies.queries,
  })
  application.post('/v1/visits', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.write')
    if (memberId === undefined) return
    const parsed = visitRecordRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_VISIT_INVALID', 'Visit is invalid')
    try {
      const result = await recordVisit({ ...parsed.data, memberId, recordedAt: dependencies.now().toISOString(), store: dependencies.store })
      return reply.header('cache-control', 'no-store').status(201).send(
        visitRecordResultSchema.parse({ schemaVersion: 'visit-record-result.v1', ...result }),
      )
    } catch (error) {
      return sendProductProblem(
        request,
        reply,
        error instanceof VisitIdConflictError ? 409 : 400,
        error instanceof VisitIdConflictError ? 'PLACE_VISIT_CONFLICT' : 'PLACE_VISIT_INVALID',
        error instanceof VisitIdConflictError ? 'Visit conflicts with an earlier record' : 'Visit is invalid',
      )
    }
  })

  application.get('/v1/places/:placeId/visit-summary', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    const parsed = placeIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_VISIT_QUERY_INVALID', 'Visit query is invalid')
    const result = await dependencies.store.summarize(memberId, parsed.data.placeId)
    return reply.header('cache-control', 'no-store').status(200).send(
      visitSummaryResponseSchema.parse({
        schemaVersion: 'visit-summary.v1', placeId: parsed.data.placeId, ...result,
      }),
    )
  })
}
