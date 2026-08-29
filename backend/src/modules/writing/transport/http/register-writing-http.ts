import type { FastifyInstance } from 'fastify'
import {
  publicationIdentifierParamsSchema,
  publishedWritingSchema,
  writingCommandRequestSchema,
} from '@place/contracts/http'
import { writingCommandResultSchema } from '@place/contracts/writing'

import { requireProductMember, sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import { applyWritingCommand } from '../../application/apply-writing-command.js'
import type { WritingStore } from '../../application/ports/writing-store.js'
import type { WritingQueries } from '../../application/writing-queries.js'
import { WritingCommandConflictError } from '../../domain/model.js'
import { registerWritingQueryHttpRoutes } from './register-writing-query-http.js'

export type WritingHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: WritingStore
  queries: WritingQueries
  now: () => Date
}>

export function registerWritingHttpRoutes(application: FastifyInstance, dependencies: WritingHttpDependencies): void {
  registerWritingQueryHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    queries: dependencies.queries,
  })

  application.post('/v1/writing/commands', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.write')
    if (memberId === undefined) return
    const parsed = writingCommandRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_WRITING_COMMAND_INVALID', 'Writing command is invalid')
    try {
      const result = await applyWritingCommand({ ...parsed.data, memberId, occurredAt: dependencies.now().toISOString(), store: dependencies.store })
      if (result.status === 'not-found') return sendProductProblem(request, reply, 404, 'PLACE_WRITING_NOT_FOUND', 'Writing not found')
      if (result.status === 'version-conflict') return sendProductProblem(request, reply, 409, 'PLACE_WRITING_VERSION_CONFLICT', 'Writing changed concurrently', true)
      const response = writingCommandResultSchema.parse({
        schemaVersion: 'writing-command-result.v1',
        ...result,
      })
      return reply.header('cache-control', 'no-store')
        .status(result.status === 'applied' ? 201 : 200).send(response)
    } catch (error) {
      return sendProductProblem(
        request,
        reply,
        error instanceof WritingCommandConflictError ? 409 : 400,
        error instanceof WritingCommandConflictError ? 'PLACE_WRITING_COMMAND_CONFLICT' : 'PLACE_WRITING_COMMAND_INVALID',
        error instanceof WritingCommandConflictError ? 'Writing command conflicts with an earlier request' : 'Writing command is invalid',
      )
    }
  })

  application.get('/v1/public/writing/:publicationId', async (request, reply) => {
    const parsed = publicationIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
    const result = await dependencies.store.getPublished(parsed.data.publicationId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
      : reply.header('cache-control', 'no-store').status(200).send(
          publishedWritingSchema.parse({
            schemaVersion: 'place-published-writing.v1',
            ...result,
          }),
        )
  })
}
