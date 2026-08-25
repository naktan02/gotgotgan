import { problemSchema } from '@place/contracts/http'
import {
  placeSearchRequestSchema,
  placeSearchResponseSchema,
  taxonomyProjectionSchema,
  type PlaceSearchRequestInput,
} from '@place/contracts/search'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'

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
