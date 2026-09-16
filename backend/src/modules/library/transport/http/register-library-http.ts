import type { FastifyInstance } from 'fastify'
import {
  libraryCommandRequestSchema,
  placeIdentifierParamsSchema,
  publishedCollectionMapQuerySchema,
  publishedCollectionMapSchema,
  publishedCollectionQuerySchema,
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
import { InvalidLibraryCursorError, InvalidLibraryQueryError } from '../../domain/queries.js'
import { registerLibraryQueryHttpRoutes } from './register-library-query-http.js'
import { registerLibraryMapV3HttpRoutes } from './register-library-map-v3-http.js'
import type { PersonalLibraryMapV3 } from '../../application/ports/personal-library-map-v3.js'
import { registerLibraryMapV4HttpRoutes } from './register-library-map-v4-http.js'
import type { PersonalLibraryMapV4 } from '../../application/ports/personal-library-map-v4.js'
import {
  registerCollectionFirstHttpRoutes,
  type CollectionFirstHttpDependencies,
} from './register-collection-first-http.js'
import {
  registerPublicCollectionHttpRoutes,
  type PublicCollectionHttpDependencies,
} from './register-public-collection-http.js'

export type LibraryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  store: LibraryStore
  queries: LibraryQueries
  now: () => Date
  mapV3?: PersonalLibraryMapV3 | undefined
  mapV4?: PersonalLibraryMapV4 | undefined
  collectionFirst?: Omit<CollectionFirstHttpDependencies, 'authorizer' | 'now'> | undefined
  publicCollections?: Omit<PublicCollectionHttpDependencies, 'authorizer' | 'now'> | undefined
}>

export function registerLibraryHttpRoutes(application: FastifyInstance, dependencies: LibraryHttpDependencies): void {
  if (dependencies.mapV3 !== undefined) registerLibraryMapV3HttpRoutes(application, { authorizer: dependencies.authorizer, map: dependencies.mapV3 })
  if (dependencies.mapV4 !== undefined) registerLibraryMapV4HttpRoutes(application, { authorizer: dependencies.authorizer, map: dependencies.mapV4 })
  registerLibraryQueryHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    queries: dependencies.queries,
  })
  if (dependencies.collectionFirst !== undefined) {
    registerCollectionFirstHttpRoutes(application, {
      authorizer: dependencies.authorizer,
      now: dependencies.now,
      ...dependencies.collectionFirst,
    })
  }
  if (dependencies.publicCollections !== undefined) {
    registerPublicCollectionHttpRoutes(application, {
      authorizer: dependencies.authorizer,
      now: dependencies.now,
      ...dependencies.publicCollections,
    })
  }
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
    const query = publishedCollectionQuerySchema.safeParse(request.query)
    if (!query.success) return sendProductProblem(request, reply, 400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid')
    try {
      const result = await dependencies.queries.getPublishedCollection({
        publicationId: parsed.data.publicationId,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      })
      return result === undefined
        ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
        : reply.header('cache-control', 'no-store').status(200).send(
            publishedCollectionSchema.parse({
              schemaVersion: 'place-published-collection.v3',
              ...result,
            }),
          )
    } catch (error) {
      if (error instanceof InvalidLibraryCursorError || error instanceof InvalidLibraryQueryError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid')
      }
      throw error
    }
  })

  application.get('/v1/public/collections/:publicationId/map', async (request, reply) => {
    const parsed = publicationIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) return sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
    const query = publishedCollectionMapQuerySchema.safeParse(request.query)
    if (!query.success) return sendProductProblem(request, reply, 400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid')
    try {
      const result = await dependencies.queries.getPublishedCollectionMap({
        publicationId: parsed.data.publicationId,
        bounds: {
          west: query.data.west,
          south: query.data.south,
          east: query.data.east,
          north: query.data.north,
        },
        zoom: query.data.zoom,
      })
      return result === undefined
        ? sendProductProblem(request, reply, 404, 'PLACE_PUBLICATION_NOT_FOUND', 'Publication not found')
        : reply.header('cache-control', 'no-store').status(200).send(
            publishedCollectionMapSchema.parse(result),
          )
    } catch (error) {
      if (error instanceof InvalidLibraryQueryError) {
        return sendProductProblem(request, reply, 400, 'PLACE_PUBLICATION_QUERY_INVALID', 'Publication query is invalid')
      }
      throw error
    }
  })
}
