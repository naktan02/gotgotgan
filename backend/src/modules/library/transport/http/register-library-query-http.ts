import {
  libraryCollectionDetailQuerySchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionIdentifierParamsSchema,
  libraryCollectionListQuerySchema,
  libraryCollectionListResponseSchema,
  libraryPlaceListQuerySchema,
  libraryPlaceListResponseSchema,
  libraryPlaceIdentifierParamsSchema,
  libraryPlaceOrganizationQuerySchema,
  libraryPlaceOrganizationResponseSchema,
  libraryTagListQuerySchema,
  libraryTagListResponseSchema,
} from '@place/contracts/library'
import type { FastifyInstance } from 'fastify'

import type { LibraryQueries } from '../../application/library-queries.js'
import {
  InvalidLibraryCursorError,
  InvalidLibraryQueryError,
} from '../../domain/queries.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type LibraryQueryHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  queries: LibraryQueries
}>

function queryFailure(request: Parameters<typeof sendProductProblem>[0], reply: Parameters<typeof sendProductProblem>[1], error: unknown) {
  return error instanceof InvalidLibraryCursorError || error instanceof InvalidLibraryQueryError
    ? sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_CURSOR_INVALID', 'Library cursor is invalid',
      )
    : sendProductProblem(
        request, reply, 503, 'PLACE_LIBRARY_QUERY_UNAVAILABLE',
        'Library query is temporarily unavailable', true,
      )
}

export function registerLibraryQueryHttpRoutes(
  application: FastifyInstance,
  dependencies: LibraryQueryHttpDependencies,
): void {
  application.get('/v1/library/places', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const parsed = libraryPlaceListQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid',
      )
    }
    try {
      const response = libraryPlaceListResponseSchema.parse(await dependencies.queries.listPlaces({
        memberId,
        state: parsed.data.state,
        tagIds: parsed.data.tagIds,
        tagMatch: parsed.data.tagMatch,
        limit: parsed.data.limit,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      }))
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/library/places/:placeId/organization', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const params = libraryPlaceIdentifierParamsSchema.safeParse(request.params)
    const query = libraryPlaceOrganizationQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid',
      )
    }
    try {
      const response = libraryPlaceOrganizationResponseSchema.parse(
        await dependencies.queries.getPlaceOrganization({
          memberId,
          placeId: params.data.placeId,
          limit: query.data.limit,
          ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        }),
      )
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/library/collections', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const parsed = libraryCollectionListQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid',
      )
    }
    try {
      const response = libraryCollectionListResponseSchema.parse(
        await dependencies.queries.listCollections({
          memberId,
          limit: parsed.data.limit,
          ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        }),
      )
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/library/collections/:collectionId', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const params = libraryCollectionIdentifierParamsSchema.safeParse(request.params)
    const query = libraryCollectionDetailQuerySchema.safeParse(request.query)
    if (!params.success || !query.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid',
      )
    }
    try {
      const detail = await dependencies.queries.getCollection({
        memberId,
        collectionId: params.data.collectionId,
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
      })
      if (detail === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND',
          'Library resource not found',
        )
      }
      const response = libraryCollectionDetailResponseSchema.parse(detail)
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })

  application.get('/v1/library/tags', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const parsed = libraryTagListQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_LIBRARY_QUERY_INVALID', 'Library query is invalid',
      )
    }
    try {
      const response = libraryTagListResponseSchema.parse(await dependencies.queries.listTags({
        memberId,
        limit: parsed.data.limit,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      }))
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return queryFailure(request, reply, error)
    }
  })
}
