import { problemSchema } from '@place/contracts/http'
import {
  catalogPlaceMapRequestSchema,
  catalogPlaceMapResponseSchema,
  catalogPlaceSearchRequestSchema,
  catalogPlaceSearchResponseSchema,
  placeSearchRequestSchema,
  placeSearchResponseSchema,
  placeSuggestionSelectionRequestSchema,
  placeSuggestionSelectionResponseSchema,
  placeSuggestionsRequestSchema,
  placeSuggestionsResponseSchema,
  taxonomyProjectionSchema,
  type CatalogPlaceMapRequestInput,
  type PlaceSearchRequestInput,
  type CatalogPlaceSearchRequestInput,
  type PlaceSuggestionSelectionRequest,
  type PlaceSuggestionsRequestInput,
} from '@place/contracts/search'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'
import {
  CATALOG_MAP_RESPONSE_MAX_BYTES,
  CATALOG_SEARCH_RESPONSE_MAX_BYTES,
  readBoundedSearchJson,
} from './bounded-search-json'

export class SearchBackendProblem extends Error {
  override readonly name = 'SearchBackendProblem'

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly correlationRef: string,
  ) {
    super(message)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeProblem(value: unknown) {
  if (!isRecord(value)) return undefined
  return problemSchema.safeParse({
    type: value.type,
    title: value.title,
    status: value.status,
    code: value.code,
    retryable: value.retryable,
    correlationRef: value.correlationRef,
  }).data
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new Error('Place Backend returned an unsupported response')
  }
  return response.json()
}

export async function searchCatalogPlaces(
  request: CatalogPlaceSearchRequestInput,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
  signal?: AbortSignal,
) {
  const body = catalogPlaceSearchRequestSchema.parse(request)
  const response = await requestFixedBackend('/v1/search/catalog', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal === undefined
      ? AbortSignal.timeout(5_000)
      : AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  }, environment, fetcher)
  const payload = await readBoundedSearchJson(response, CATALOG_SEARCH_RESPONSE_MAX_BYTES)
  if (!response.ok) {
    const problem = safeProblem(payload)
    if (problem !== undefined) {
      throw new SearchBackendProblem(
        problem.status, problem.code, problem.title, problem.retryable, problem.correlationRef,
      )
    }
    throw new Error('Catalog search Backend is unavailable')
  }
  return catalogPlaceSearchResponseSchema.parse(payload)
}

export async function searchCatalogMap(
  request: CatalogPlaceMapRequestInput,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
  signal?: AbortSignal,
) {
  const body = catalogPlaceMapRequestSchema.parse(request)
  const response = await requestFixedBackend('/v1/search/catalog/map', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal === undefined
      ? AbortSignal.timeout(5_000)
      : AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  }, environment, fetcher)
  const payload = await readBoundedSearchJson(response, CATALOG_MAP_RESPONSE_MAX_BYTES)
  if (!response.ok) {
    const problem = safeProblem(payload)
    if (problem !== undefined) {
      throw new SearchBackendProblem(
        problem.status, problem.code, problem.title, problem.retryable, problem.correlationRef,
      )
    }
    throw new Error('Catalog map Backend is unavailable')
  }
  return catalogPlaceMapResponseSchema.parse(payload)
}

export async function searchPlaces(
  request: PlaceSearchRequestInput,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
  signal?: AbortSignal,
) {
  const body = placeSearchRequestSchema.parse(request)
  const response = await requestFixedBackend('/v1/search/places', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal === undefined
      ? AbortSignal.timeout(5_000)
      : AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  }, environment, fetcher)
  const payload = await responseJson(response)
  if (!response.ok) {
    const problem = safeProblem(payload)
    if (problem !== undefined) {
      throw new SearchBackendProblem(
        problem.status,
        problem.code,
        problem.title,
        problem.retryable,
        problem.correlationRef,
      )
    }
    throw new Error('Place search Backend is unavailable')
  }
  return placeSearchResponseSchema.parse(payload)
}

export async function suggestPlaces(
  request: PlaceSuggestionsRequestInput,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
  signal?: AbortSignal,
) {
  const body = placeSuggestionsRequestSchema.parse(request)
  const response = await requestFixedBackend('/v1/search/suggestions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal === undefined
      ? AbortSignal.timeout(3_000)
      : AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
  }, environment, fetcher)
  const payload = await responseJson(response)
  if (!response.ok) {
    const problem = safeProblem(payload)
    if (problem !== undefined) {
      throw new SearchBackendProblem(
        problem.status, problem.code, problem.title, problem.retryable, problem.correlationRef,
      )
    }
    throw new Error('Place suggestion Backend is unavailable')
  }
  return placeSuggestionsResponseSchema.parse(payload)
}

export async function selectPlaceSuggestion(
  request: PlaceSuggestionSelectionRequest,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
  signal?: AbortSignal,
) {
  const body = placeSuggestionSelectionRequestSchema.parse(request)
  const response = await requestFixedBackend('/v1/search/suggestion-selections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal === undefined
      ? AbortSignal.timeout(3_000)
      : AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
  }, environment, fetcher)
  const payload = await responseJson(response)
  if (!response.ok) {
    const problem = safeProblem(payload)
    if (problem !== undefined) {
      throw new SearchBackendProblem(
        problem.status, problem.code, problem.title, problem.retryable, problem.correlationRef,
      )
    }
    throw new Error('Place suggestion selection Backend is unavailable')
  }
  return placeSuggestionSelectionResponseSchema.parse(payload)
}

export async function getSearchTaxonomy(
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
) {
  const response = await requestFixedBackend('/v1/taxonomy/nodes', {
    method: 'GET', signal: AbortSignal.timeout(5_000),
  }, environment, fetcher)
  if (!response.ok) throw new Error('Place taxonomy Backend is unavailable')
  return taxonomyProjectionSchema.parse(await responseJson(response))
}
