import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireProductMember, sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import { applyLibraryCommand } from '../../application/apply-library-command.js'
import type { LibraryStore } from '../../application/ports/library-store.js'
import { LibraryCommandConflictError } from '../../domain/model.js'

const uuid = z.string().uuid()
const command = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set-place-preferences'), placeId: uuid, saved: z.boolean(), wanted: z.boolean(), personalRating: z.number().min(0.1).max(5).multipleOf(0.1).nullable() }).strict(),
  z.object({ kind: z.literal('create-collection'), collectionId: uuid, name: z.string().min(1).max(120), description: z.string().max(2000).optional(), visibility: z.enum(['private', 'unlisted', 'public']), publicationId: uuid.optional() }).strict(),
  z.object({ kind: z.literal('add-collection-place'), collectionId: uuid, placeId: uuid, position: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('create-tag'), tagId: uuid, name: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('tag-place'), tagId: uuid, placeId: uuid }).strict(),
  z.object({ kind: z.literal('copy-published-collection'), sourcePublicationId: uuid, targetCollectionId: uuid, targetName: z.string().min(1).max(120) }).strict(),
])
const body = z.object({ commandId: uuid, command }).strict()
const publication = z.object({ publicationId: uuid })
const place = z.object({ placeId: uuid })

export type LibraryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: LibraryStore
  now: () => Date
}>

export function registerLibraryHttpRoutes(application: FastifyInstance, dependencies: LibraryHttpDependencies): void {
  application.get('/v1/library', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    return reply.header('cache-control', 'no-store').status(200).send(await dependencies.store.getMemberLibrary(memberId))
  })

  application.post('/v1/library/commands', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.write')
    if (memberId === undefined) return
    const parsed = body.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_COMMAND_INVALID', 'Library command is invalid')
    try {
      const result = await applyLibraryCommand({ ...parsed.data, memberId, occurredAt: dependencies.now().toISOString(), store: dependencies.store })
      if (result.status === 'not-found') return sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      if (result.status === 'forbidden') return sendProductProblem(request, reply, 403, 'PLACE_ACCESS_DENIED', 'Access denied')
      return reply.header('cache-control', 'no-store').status(result.status === 'applied' ? 201 : 200).send(result)
    } catch (error) {
      if (error instanceof LibraryCommandConflictError) return sendProductProblem(request, reply, 409, 'PLACE_LIBRARY_COMMAND_CONFLICT', 'Library command conflicts with an earlier request')
      return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_COMMAND_INVALID', 'Library command is invalid')
    }
  })

  application.get('/v1/library/places/:placeId', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    const parsed = place.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid')
    const result = await dependencies.store.getPlacePreferences?.(memberId, parsed.data.placeId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      : reply.header('cache-control', 'no-store').status(200).send(result)
  })

  application.get('/v1/public/collections/:publicationId', async (request, reply) => {
    const parsed = publication.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
    const result = await dependencies.store.getPublishedCollection(parsed.data.publicationId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
      : reply.header('cache-control', 'public, max-age=60').status(200).send(result)
  })
}
