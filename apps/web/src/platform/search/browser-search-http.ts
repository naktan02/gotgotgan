import { randomUUID } from 'node:crypto'

import {
  catalogPlaceMapRequestSchema,
  catalogPlaceSearchRequestSchema,
  placeSearchRequestSchema,
  placeSuggestionSelectionRequestSchema,
  placeSuggestionsRequestSchema,
  type CatalogPlaceMapRequestInput,
  type PlaceSearchRequestInput,
  type CatalogPlaceSearchRequestInput,
  type PlaceSuggestionSelectionRequest,
  type PlaceSuggestionsRequestInput,
} from '@place/contracts/search'

import {
  getSearchTaxonomy,
  SearchBackendProblem,
  searchCatalogMap,
  searchCatalogPlaces,
  searchPlaces,
  selectPlaceSuggestion,
  suggestPlaces,
} from './search-backend-client'
import {
  CATALOG_MAP_REQUEST_MAX_BYTES,
  readBoundedSearchJson,
} from './bounded-search-json'

type SearchBackend = Readonly<{
  catalog?: (request: CatalogPlaceSearchRequestInput, signal: AbortSignal) => Promise<unknown>
  catalogMap?: (request: CatalogPlaceMapRequestInput, signal: AbortSignal) => Promise<unknown>
  places: (request: PlaceSearchRequestInput, signal: AbortSignal) => Promise<unknown>
  suggestions: (request: PlaceSuggestionsRequestInput, signal: AbortSignal) => Promise<unknown>
  selectSuggestion: (request: PlaceSuggestionSelectionRequest, signal: AbortSignal) => Promise<unknown>
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
    async catalogMap(request: Request): Promise<Response> {
      let raw: unknown
      try {
        raw = await readBoundedSearchJson(request, CATALOG_MAP_REQUEST_MAX_BYTES)
      } catch {
        return invalid('PLACE_CATALOG_MAP_REQUEST_INVALID', '카탈로그 지도 조건이 올바르지 않습니다.')
      }
      const parsed = catalogPlaceMapRequestSchema.safeParse(raw)
      const body = parsed.success ? parsed.data : undefined
      if (body === undefined) {
        return invalid('PLACE_CATALOG_MAP_REQUEST_INVALID', '카탈로그 지도 조건이 올바르지 않습니다.')
      }
      if (dependencies.backend.catalogMap === undefined) {
        return unavailable('PLACE_CATALOG_MAP_UNAVAILABLE', '카탈로그 지도를 잠시 사용할 수 없습니다.')
      }
      try {
        return success(await dependencies.backend.catalogMap(body, request.signal))
      } catch (error) {
        return failure(
          error, (status) => status === 400 ? 400 : 503,
          'PLACE_CATALOG_MAP_UNAVAILABLE', '카탈로그 지도를 잠시 사용할 수 없습니다.',
        )
      }
    },

    async catalog(request: Request): Promise<Response> {
      const body = await payload(request, catalogPlaceSearchRequestSchema)
      if (body === undefined) {
        return invalid('PLACE_CATALOG_SEARCH_REQUEST_INVALID', '카탈로그 검색 조건이 올바르지 않습니다.')
      }
      if (dependencies.backend.catalog === undefined) {
        return unavailable('PLACE_CATALOG_SEARCH_UNAVAILABLE', '카탈로그 검색을 잠시 사용할 수 없습니다.')
      }
      try {
        return success(await dependencies.backend.catalog(body, request.signal))
      } catch (error) {
        return failure(
          error, (status) => status === 400 ? 400 : 503,
          'PLACE_CATALOG_SEARCH_UNAVAILABLE', '카탈로그 검색을 잠시 사용할 수 없습니다.',
        )
      }
    },

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
    catalogMap: (request, signal) => searchCatalogMap(request, process.env, fetch, signal),
    catalog: (request, signal) => searchCatalogPlaces(request, process.env, fetch, signal),
    places: (request, signal) => searchPlaces(request, process.env, fetch, signal),
    suggestions: (request, signal) => suggestPlaces(request, process.env, fetch, signal),
    selectSuggestion: (request, signal) => selectPlaceSuggestion(request, process.env, fetch, signal),
    taxonomy: () => getSearchTaxonomy(),
  },
  createCorrelationRef: randomUUID,
})
