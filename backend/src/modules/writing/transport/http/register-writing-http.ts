import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireProductMember, sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import { applyWritingCommand } from '../../application/apply-writing-command.js'
import type { WritingStore } from '../../application/ports/writing-store.js'
import { WritingCommandConflictError } from '../../domain/model.js'

const uuid = z.string().uuid()
const publicationFields = {
  visibility: z.enum(['private', 'unlisted', 'public']),
  publicationId: uuid.optional(),
}
const command = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create-note'), documentId: uuid, body: z.string().min(1).max(2000), placeId: uuid, ...publicationFields }).strict(),
  z.object({ kind: z.literal('update-note'), documentId: uuid, expectedVersion: z.number().int().positive(), body: z.string().min(1).max(2000), placeId: uuid, ...publicationFields }).strict(),
  z.object({ kind: z.literal('create-entry'), documentId: uuid, title: z.string().min(1).max(200), body: z.string().min(1).max(100000), placeIds: z.array(uuid).min(1).max(32), ...publicationFields }).strict(),
  z.object({ kind: z.literal('update-entry'), documentId: uuid, expectedVersion: z.number().int().positive(), title: z.string().min(1).max(200), body: z.string().min(1).max(100000), placeIds: z.array(uuid).min(1).max(32), ...publicationFields }).strict(),
])
const body = z.object({ commandId: uuid, command }).strict()
const publication = z.object({ publicationId: uuid })

export type WritingHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: WritingStore
  now: () => Date
}>

export function registerWritingHttpRoutes(application: FastifyInstance, dependencies: WritingHttpDependencies): void {
  application.get('/v1/writing', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    return reply.header('cache-control', 'no-store').status(200).send({ items: await dependencies.store.listMemberWriting(memberId) })
  })

  application.post('/v1/writing/commands', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.write')
    if (memberId === undefined) return
    const parsed = body.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_WRITING_COMMAND_INVALID', 'Writing command is invalid')
    try {
      const result = await applyWritingCommand({ ...parsed.data, memberId, occurredAt: dependencies.now().toISOString(), store: dependencies.store })
      if (result.status === 'not-found') return sendProductProblem(request, reply, 404, 'PLACE_WRITING_NOT_FOUND', 'Writing not found')
      if (result.status === 'version-conflict') return sendProductProblem(request, reply, 409, 'PLACE_WRITING_VERSION_CONFLICT', 'Writing changed concurrently', true)
      return reply.header('cache-control', 'no-store').status(result.status === 'applied' ? 201 : 200).send(result)
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
    const parsed = publication.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
    const result = await dependencies.store.getPublished(parsed.data.publicationId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
      : reply.header('cache-control', 'public, max-age=60').status(200).send(result)
  })
}
