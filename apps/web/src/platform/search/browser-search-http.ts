import { randomUUID } from 'node:crypto'

import {
  placeSearchRequestSchema,
  placeSuggestionSelectionRequestSchema,
  placeSuggestionsRequestSchema,
  providerPlaceDetailRequestSchema,
  type PlaceSearchRequestInput,
  type PlaceSuggestionSelectionRequest,
  type PlaceSuggestionsRequestInput,
  type ProviderPlaceDetailRequest,
} from '@place/contracts/search'

import {
  getProviderPlaceDetail,
  getSearchTaxonomy,
  SearchBackendProblem,
  searchPlaces,
  selectPlaceSuggestion,
  suggestPlaces,
} from './search-backend-client'

type SearchBackend = Readonly<{
  places: (request: PlaceSearchRequestInput, signal: AbortSignal) => Promise<unknown>
  suggestions: (request: PlaceSuggestionsRequestInput, signal: AbortSignal) => Promise<unknown>
  selectSuggestion: (request: PlaceSuggestionSelectionRequest, signal: AbortSignal) => Promise<unknown>
  providerDetail: (request: ProviderPlaceDetailRequest, signal: AbortSignal) => Promise<unknown>
  taxonomy: () => Promise<unknown>
}>

type Dependencies = Readonly<{
  backend: SearchBackend
  createCorrelationRef: () => string
}>

type RequestSchema<T> = Readonly<{
  safeParse: (value: unknown) =>
    | Readonly<{ success: true; data: T }>
    | Readonly<{ success: false }>
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function problem(
  status: number,
  code: string,
  title: string,
  retryable: boolean,
  correlationRef: string,
): Response {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title,
    status,
    code,
    retryable,
    correlationRef,
  }, {
    status,
    headers: { ...privateHeaders, 'content-type': 'application/problem+json' },
  })
}

async function payload<T>(request: Request, schema: RequestSchema<T>): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function createBrowserSearchHttp(dependencies: Dependencies) {
  const unavailable = (code: string, title: string) => problem(
    503, code, title, true, dependencies.createCorrelationRef(),
  )
  const invalid = (code: string, title: string) => problem(
    400, code, title, false, dependencies.createCorrelationRef(),
  )
  const success = (value: unknown, cacheControl = 'no-store') => Response.json(value, {
    headers: { ...privateHeaders, 'cache-control': cacheControl },
  })

  function failure(
    error: unknown,
    allowedStatus: (status: number) => number,
    fallbackCode: string,
    fallbackTitle: string,
  ): Response {
    if (error instanceof SearchBackendProblem) {
      return problem(
        allowedStatus(error.status),
        error.code,
        error.message,
        error.retryable,
        error.correlationRef,
      )
    }
    return unavailable(fallbackCode, fallbackTitle)
  }

  return {
    async places(request: Request): Promise<Response> {
      const body = await payload(request, placeSearchRequestSchema)
      if (body === undefined) {
        return invalid('PLACE_SEARCH_REQUEST_INVALID', '검색 조건이 올바르지 않습니다.')
      }
      try {
        return success(await dependencies.backend.places(body, request.signal))
      } catch (error) {
        return failure(error, () => 503, 'PLACE_SEARCH_UNAVAILABLE', '검색을 잠시 사용할 수 없습니다.')
      }
    },

    async suggestions(request: Request): Promise<Response> {
      const body = await payload(request, placeSuggestionsRequestSchema)
      if (body === undefined) {
        return invalid('PLACE_SUGGESTION_REQUEST_INVALID', '자동완성 요청이 올바르지 않습니다.')
      }
      try {
        return success(await dependencies.backend.suggestions(body, request.signal))
      } catch (error) {
        return failure(
          error, () => 503,
          'PLACE_SUGGESTIONS_UNAVAILABLE', '자동완성을 잠시 사용할 수 없습니다.',
        )
      }
    },

    async selectSuggestion(request: Request): Promise<Response> {
      const body = await payload(request, placeSuggestionSelectionRequestSchema)
      if (body === undefined) {
        return invalid('PLACE_SUGGESTION_SELECTION_INVALID', '장소 선택 요청이 올바르지 않습니다.')
      }
      try {
        return success(await dependencies.backend.selectSuggestion(body, request.signal))
      } catch (error) {
        return failure(
          error, (status) => status === 404 ? 404 : 503,
          'PLACE_SUGGESTION_SELECTION_UNAVAILABLE', '장소 선택을 잠시 처리할 수 없습니다.',
        )
      }
    },

    async providerDetail(request: Request): Promise<Response> {
      const body = await payload(request, providerPlaceDetailRequestSchema)
      if (body === undefined) {
        return invalid('PLACE_PROVIDER_DETAIL_REQUEST_INVALID', '상세 조회 요청이 올바르지 않습니다.')
      }
      try {
        return success(await dependencies.backend.providerDetail(body, request.signal))
      } catch (error) {
        return failure(
          error, (status) => status === 400 ? 400 : 503,
          'PLACE_PROVIDER_DETAIL_UNAVAILABLE', '장소 상세를 불러올 수 없습니다.',
        )
      }
    },

    async taxonomy(): Promise<Response> {
      try {
        return success(await dependencies.backend.taxonomy(), 'public, max-age=300')
      } catch {
        return unavailable('PLACE_TAXONOMY_UNAVAILABLE', '분류를 잠시 불러올 수 없습니다.')
      }
    },
  }
}

export const browserSearchHttp = createBrowserSearchHttp({
  backend: {
    places: (request, signal) => searchPlaces(request, process.env, fetch, signal),
    suggestions: (request, signal) => suggestPlaces(request, process.env, fetch, signal),
    selectSuggestion: (request, signal) => selectPlaceSuggestion(request, process.env, fetch, signal),
    providerDetail: (request, signal) => getProviderPlaceDetail(request, process.env, fetch, signal),
    taxonomy: () => getSearchTaxonomy(),
  },
  createCorrelationRef: randomUUID,
})
