import {
  placeSuggestionMaterializationRequestSchema,
  placeSuggestionMaterializationResponseSchema,
  placeSuggestionSelectionRequestSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsRequestSchema,
  placeSuggestionsResponseSchema,
} from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'

import {
  InvalidPlaceSuggestionError,
  PlaceSuggestionReferenceUnavailableError,
  type PlaceSuggestionQuery,
  type PlaceSuggestionsPage,
  type SuggestionMaterializationIntent,
} from '../../domain/suggestions.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type SuggestionHttpDependencies = Readonly<{
  suggest: (query: PlaceSuggestionQuery) => Promise<PlaceSuggestionsPage>
  select: (suggestionId: string) => Promise<unknown>
  materialize: (suggestionId: string, intent: SuggestionMaterializationIntent) => Promise<unknown>
}>

export function registerSuggestionHttpRoutes(
  application: FastifyInstance,
  dependencies: SuggestionHttpDependencies,
  authorizer?: ProductAuthorizer,
): void {
  application.post('/v1/search/suggestions', async (request, reply) => {
    const parsed = placeSuggestionsRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_SUGGESTION_REQUEST_INVALID', 'Suggestion request is invalid')
    }
    try {
      const response = await dependencies.suggest({
        query: parsed.data.query,
        limit: parsed.data.limit,
        ...(parsed.data.sessionId === undefined ? {} : { sessionId: parsed.data.sessionId }),
        ...(parsed.data.bounds === undefined ? {} : { bounds: parsed.data.bounds }),
        ...(parsed.data.areaText === undefined ? {} : { areaText: parsed.data.areaText }),
        ...(parsed.data.language === undefined ? {} : { language: parsed.data.language }),
      })
      return reply.header('cache-control', 'no-store').status(200).send(
        placeSuggestionsResponseSchema.parse(response),
      )
    } catch (error) {
      if (error instanceof InvalidPlaceSuggestionError) {
        return sendProductProblem(request, reply, 400, 'PLACE_SUGGESTION_REQUEST_INVALID', 'Suggestion request is invalid')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_SUGGESTIONS_UNAVAILABLE', 'Suggestions are temporarily unavailable', true)
    }
  })

  application.post('/v1/search/suggestion-selections', async (request, reply) => {
    const parsed = placeSuggestionSelectionRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_SUGGESTION_SELECTION_INVALID', 'Suggestion selection is invalid')
    }
    try {
      const response = await dependencies.select(parsed.data.suggestionId)
      return reply.header('cache-control', 'no-store').status(200).send(
        placeSuggestionSelectionResponseSchema.parse(response),
      )
    } catch (error) {
      if (error instanceof PlaceSuggestionReferenceUnavailableError) {
        return sendProductProblem(request, reply, 404, 'PLACE_SUGGESTION_NOT_FOUND', 'Suggestion is unavailable')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_SUGGESTION_SELECTION_UNAVAILABLE', 'Suggestion selection is temporarily unavailable', true)
    }
  })

  application.post('/v1/search/suggestion-materializations', async (request, reply) => {
    const parsed = placeSuggestionMaterializationRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_SUGGESTION_MATERIALIZATION_INVALID', 'Suggestion materialization is invalid')
    }
    if (authorizer === undefined) {
      return sendProductProblem(request, reply, 503, 'PLACE_SEARCH_AUTHORIZATION_UNAVAILABLE', 'Search authorization is unavailable', true)
    }
    const memberId = await requireProductMember(request, reply, authorizer, 'library.write')
    if (memberId === undefined) return reply
    try {
      const response = await dependencies.materialize(parsed.data.suggestionId, parsed.data.intent)
      return reply.header('cache-control', 'no-store').status(200).send(
        placeSuggestionMaterializationResponseSchema.parse(response),
      )
    } catch (error) {
      if (error instanceof PlaceSuggestionReferenceUnavailableError) {
        return sendProductProblem(request, reply, 404, 'PLACE_SUGGESTION_NOT_FOUND', 'Suggestion is unavailable')
      }
      return sendProductProblem(request, reply, 503, 'PLACE_SUGGESTION_MATERIALIZATION_UNAVAILABLE', 'Suggestion materialization is temporarily unavailable', true)
    }
  })
}
