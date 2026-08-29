import type { FastifyInstance } from 'fastify'
import {
  libraryCommandRequestSchema,
  placeIdentifierParamsSchema,
  publishedCollectionSchema,
  publicationIdentifierParamsSchema,
} from '@place/contracts/http'
import {
  libraryCommandResultSchema,
  libraryPlacePreferencesResponseSchema,
} from '@place/contracts/library'

import { requireProductMember, sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import { applyLibraryCommand } from '../../application/apply-library-command.js'
import type { LibraryStore } from '../../application/ports/library-store.js'
import {
  LibraryCommandConflictError,
  LibraryCollectionVersionConflictError,
  LibraryPreferenceVersionConflictError,
} from '../../domain/model.js'
import type { LibraryQueries } from '../../application/library-queries.js'
import { registerLibraryQueryHttpRoutes } from './register-library-query-http.js'

export type LibraryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: LibraryStore
  queries: LibraryQueries
  now: () => Date
}>

export function registerLibraryHttpRoutes(application: FastifyInstance, dependencies: LibraryHttpDependencies): void {
  registerLibraryQueryHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    queries: dependencies.queries,
  })
  application.post('/v1/library/commands', async (request, reply) => {
    const parsed = libraryCommandRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_COMMAND_INVALID', 'Library command is invalid')
    const permission = parsed.data.command.kind === 'set-collection-publication'
      ? 'library.share'
      : 'library.write'
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, permission)
    if (memberId === undefined) return
    try {
      const result = await applyLibraryCommand({ ...parsed.data, memberId, occurredAt: dependencies.now().toISOString(), store: dependencies.store })
      if (result.status === 'not-found') return sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      if (result.status === 'forbidden') return sendProductProblem(request, reply, 403, 'PLACE_ACCESS_DENIED', 'Access denied')
      const response = libraryCommandResultSchema.parse({
        schemaVersion: 'library-command-result.v1', status: result.status,
      })
      return reply.header('cache-control', 'no-store')
        .status(result.status === 'applied' ? 201 : 200).send(response)
    } catch (error) {
      if (error instanceof LibraryCommandConflictError) return sendProductProblem(request, reply, 409, 'PLACE_LIBRARY_COMMAND_CONFLICT', 'Library command conflicts with an earlier request')
      if (error instanceof LibraryCollectionVersionConflictError) return sendProductProblem(request, reply, 409, 'PLACE_LIBRARY_COLLECTION_VERSION_CONFLICT', 'Collection changed after it was read', true)
      if (error instanceof LibraryPreferenceVersionConflictError) return sendProductProblem(request, reply, 409, 'PLACE_LIBRARY_PREFERENCE_VERSION_CONFLICT', 'Place preferences changed after they were read', true)
      return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_COMMAND_INVALID', 'Library command is invalid')
    }
  })

  application.get('/v1/library/places/:placeId', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    const parsed = placeIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid')
    const result = await dependencies.store.getPlacePreferences(memberId, parsed.data.placeId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      : reply.header('cache-control', 'no-store').status(200).send(
          libraryPlacePreferencesResponseSchema.parse({
            schemaVersion: 'library-place-preferences.v1',
            placeId: result.placeId,
            saved: result.saved,
            wanted: result.wanted,
            personalRating: result.personalRating,
            updatedAt: result.updatedAt,
          }),
        )
  })

  application.get('/v1/public/collections/:publicationId', async (request, reply) => {
    const parsed = publicationIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
    const result = await dependencies.queries.getPublishedCollection(parsed.data.publicationId)
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
      : reply.header('cache-control', 'no-store').status(200).send(
          publishedCollectionSchema.parse({
            schemaVersion: 'place-published-collection.v2',
            ...result,
          }),
        )
  })
}
