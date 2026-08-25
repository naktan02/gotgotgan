import { randomUUID } from 'node:crypto'

import { placeSuggestionsRequestSchema } from '@place/contracts/search'

import { SearchBackendProblem, suggestPlaces } from '@/platform/search/search-backend-client'

function problem(status: 400 | 503, code: string, title: string, retryable: boolean, correlationRef: string = randomUUID()) {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return problem(400, 'PLACE_SUGGESTION_REQUEST_INVALID', '자동완성 요청이 올바르지 않습니다.', false)
  }
  const parsed = placeSuggestionsRequestSchema.safeParse(payload)
  if (!parsed.success) {
    return problem(400, 'PLACE_SUGGESTION_REQUEST_INVALID', '자동완성 요청이 올바르지 않습니다.', false)
  }
  try {
    return Response.json(await suggestPlaces(parsed.data, process.env, fetch, request.signal), {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  } catch (error) {
    if (error instanceof SearchBackendProblem) {
      return problem(503, error.code, error.message, error.retryable, error.correlationRef)
    }
    return problem(503, 'PLACE_SUGGESTIONS_UNAVAILABLE', '자동완성을 잠시 사용할 수 없습니다.', true)
  }
}
