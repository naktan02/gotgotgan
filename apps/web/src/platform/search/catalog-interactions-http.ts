import {
  catalogExplorationRequestSchema, catalogExplorationResponseSchema,
  catalogExplorationRequestV2Schema, catalogExplorationResponseV2Schema,
  catalogPlaceMapRequestV2Schema, catalogPlaceMapResponseV2Schema,
  catalogPlaceMapRequestV3Schema, catalogPlaceMapResponseV3Schema,
  catalogPlaceSearchRequestV2Schema, catalogPlaceSearchResponseV2Schema,
} from '@place/contracts/search'
import { randomUUID } from 'node:crypto'
import { requestFixedBackend, type BackendEnvironment, type BackendFetcher } from '../backend-http/fixed-backend'
import { readBoundedSearchJson, CATALOG_MAP_RESPONSE_MAX_BYTES, CATALOG_SEARCH_REQUEST_MAX_BYTES } from './bounded-search-json'

const routes = {
  explore: { path: '/v1/search/catalog/explore', input: catalogExplorationRequestSchema, output: catalogExplorationResponseSchema },
  exploreV2: { path: '/v2/search/catalog/explore', input: catalogExplorationRequestV2Schema, output: catalogExplorationResponseV2Schema },
  search: { path: '/v2/search/catalog', input: catalogPlaceSearchRequestV2Schema, output: catalogPlaceSearchResponseV2Schema },
  map: { path: '/v2/search/catalog/map', input: catalogPlaceMapRequestV2Schema, output: catalogPlaceMapResponseV2Schema },
  mapV3: { path: '/v3/search/catalog/map', input: catalogPlaceMapRequestV3Schema, output: catalogPlaceMapResponseV3Schema },
} as const

/** Fixed internal catalog only: no provider credentials or user-supplied upstream URL. */
export async function catalogInteractionHttp(
  kind: keyof typeof routes, request: Request,
  environment: BackendEnvironment = process.env, fetcher: BackendFetcher = fetch,
): Promise<Response> {
  const route = routes[kind]
  const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
  const problem = (status: number) => Response.json({
    type: 'urn:place:error:catalog-interaction', status,
    title: status === 400 ? '검색 조건이 올바르지 않습니다.' : '검색을 잠시 사용할 수 없습니다.',
    code: status === 400 ? 'PLACE_CATALOG_REQUEST_INVALID' : 'PLACE_CATALOG_UNAVAILABLE',
    retryable: status !== 400, correlationRef: randomUUID(),
  }, { status, headers: { ...headers, 'content-type': 'application/problem+json' } })
  let body: unknown
  try {
    const parsed = route.input.safeParse(await readBoundedSearchJson(request, CATALOG_SEARCH_REQUEST_MAX_BYTES))
    if (!parsed.success) return problem(400)
    body = parsed.data
  } catch { return problem(400) }
  try {
    const response = await requestFixedBackend(route.path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    }, environment, fetcher)
    if (!response.ok) return problem(response.status === 400 ? 400 : 503)
    const output = route.output.parse(await readBoundedSearchJson(response, CATALOG_MAP_RESPONSE_MAX_BYTES))
    return Response.json(output, { headers })
  } catch { return problem(503) }
}
