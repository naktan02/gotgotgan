import {
  placeSearchRequestSchema,
  placeSearchResponseSchema,
} from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'

import { InvalidSearchCursorError, type PlaceSearchPage, type PlaceSearchQuery } from '../../domain/model.js'
import { sendProductProblem, type ProductAuthorizer } from '../../../../platform/http/product-authorization.js'

function usesPersonalFilters(query: PlaceSearchQuery): boolean {
  return query.filters.saved !== undefined || query.filters.wanted !== undefined ||
    query.filters.visited !== undefined || query.filters.minimumPersonalRating !== undefined
}

export type SearchHttpDependencies = Readonly<{
  search: (query: PlaceSearchQuery) => Promise<PlaceSearchPage>
  authorizer?: ProductAuthorizer
}>

export function registerSearchHttpRoutes(
  application: FastifyInstance,
  dependencies: SearchHttpDependencies,
): void {
  application.post('/v1/search/places', async (request, reply) => {
    const parsed = placeSearchRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_SEARCH_REQUEST_INVALID', 'Search request is invalid')
    }

    let viewerMemberId: string | undefined
    if (request.headers.authorization !== undefined) {
      if (dependencies.authorizer === undefined) {
        return sendProductProblem(request, reply, 503, 'PLACE_SEARCH_AUTHORIZATION_UNAVAILABLE', 'Search authorization is unavailable', true)
      }
      const authorization = await dependencies.authorizer(request.headers.authorization, 'search.read')
      if (authorization.status !== 'authorized') {
        return sendProductProblem(
          request,
          reply,
          authorization.status === 'authentication-required' ? 401 : 403,
          authorization.status === 'authentication-required' ? 'PLACE_AUTHENTICATION_REQUIRED' : 'PLACE_ACCESS_DENIED',
          authorization.status === 'authentication-required' ? 'Authentication required' : 'Access denied',
        )
      }
      viewerMemberId = authorization.memberId
    }

    const query: PlaceSearchQuery = {
      query: parsed.data.query,
      filters: {
        taxonomyKeys: parsed.data.filters.taxonomyKeys,
        ...(parsed.data.filters.saved === undefined ? {} : { saved: parsed.data.filters.saved }),
        ...(parsed.data.filters.wanted === undefined ? {} : { wanted: parsed.data.filters.wanted }),
        ...(parsed.data.filters.visited === undefined ? {} : { visited: parsed.data.filters.visited }),
        ...(parsed.data.filters.minimumPersonalRating === undefined
          ? {}
          : { minimumPersonalRating: parsed.data.filters.minimumPersonalRating }),
      },
      limit: parsed.data.limit,
      ...(parsed.data.bounds === undefined ? {} : { bounds: parsed.data.bounds }),
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
      ...(viewerMemberId === undefined ? {} : { viewerMemberId }),
    }
    if (viewerMemberId === undefined && usesPersonalFilters(query)) {
      return sendProductProblem(request, reply, 401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required')
    }

    try {
      const result = await dependencies.search(query)
      if (result.sources.every((source) => source.status === 'unavailable')) {
        return sendProductProblem(request, reply, 503, 'PLACE_SEARCH_UNAVAILABLE', 'Search is temporarily unavailable', true)
      }
      const response = placeSearchResponseSchema.parse(result)
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      if (error instanceof InvalidSearchCursorError) {
        return sendProductProblem(request, reply, 400, 'PLACE_SEARCH_CURSOR_INVALID', 'Search cursor is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_SEARCH_UNAVAILABLE', 'Search is temporarily unavailable', true)
    }
  })
}
