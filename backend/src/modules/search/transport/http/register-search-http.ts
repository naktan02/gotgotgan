import {
  catalogPlaceSearchRequestSchema,
  catalogPlaceSearchResponseSchema,
  placeSearchRequestSchema,
  placeSearchResponseSchema,
} from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'

import type {
  CatalogPlaceSearchInput,
  CatalogPlaceSearchPage,
} from '../../domain/catalog-home-search.js'
import { InvalidSearchCursorError, type PlaceSearchPage, type PlaceSearchQuery } from '../../domain/model.js'
import {
  resolveOptionalProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import {
  registerSuggestionHttpRoutes,
  type SuggestionHttpDependencies,
} from './register-suggestion-http.js'

function usesPersonalFilters(query: PlaceSearchQuery): boolean {
  return query.filters.saved !== undefined || query.filters.wanted !== undefined ||
    query.filters.visited !== undefined || query.filters.minimumPersonalRating !== undefined
}

export type SearchHttpDependencies = Readonly<{
  search: (query: PlaceSearchQuery) => Promise<PlaceSearchPage>
  catalog?: (query: CatalogPlaceSearchInput) => Promise<CatalogPlaceSearchPage>
  authorizer?: ProductAuthorizer
  suggestions?: SuggestionHttpDependencies
}>

export function registerSearchHttpRoutes(
  application: FastifyInstance,
  dependencies: SearchHttpDependencies,
): void {
  if (dependencies.suggestions !== undefined) {
    registerSuggestionHttpRoutes(application, dependencies.suggestions, dependencies.authorizer)
  }
  if (dependencies.catalog !== undefined) {
    application.post('/v1/search/catalog', async (request, reply) => {
      const parsed = catalogPlaceSearchRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendProductProblem(
          request,
          reply,
          400,
          'PLACE_CATALOG_SEARCH_REQUEST_INVALID',
          'Catalog search request is invalid',
        )
      }
      try {
        const result = await dependencies.catalog!({
          query: parsed.data.query,
          excludedTokenIds: parsed.data.excludedTokenIds,
          limit: parsed.data.limit,
          ...(parsed.data.bounds === undefined ? {} : { bounds: parsed.data.bounds }),
          ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        })
        const response = catalogPlaceSearchResponseSchema.parse(result)
        return reply.header('cache-control', 'no-store').status(200).send(response)
      } catch (error) {
        if (error instanceof InvalidSearchCursorError) {
          return sendProductProblem(
            request,
            reply,
            400,
            'PLACE_CATALOG_SEARCH_CURSOR_INVALID',
            'Catalog search cursor is invalid',
          )
        }
        return sendProductProblem(
          request,
          reply,
          503,
          'PLACE_CATALOG_SEARCH_UNAVAILABLE',
          'Catalog search is temporarily unavailable',
          true,
        )
      }
    })
  }
  application.post('/v1/search/places', async (request, reply) => {
    const parsed = placeSearchRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_SEARCH_REQUEST_INVALID', 'Search request is invalid')
    }

    const viewer = await resolveOptionalProductMember(
      request,
      reply,
      dependencies.authorizer,
      'search.read',
    )
    if (viewer.kind === 'replied') return
    const viewerMemberId = viewer.kind === 'member' ? viewer.memberId : undefined

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
