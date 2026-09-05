import { randomUUID } from 'node:crypto'
import { catalogPlaceSearchRequestSchema, catalogPlaceSearchResponseSchema } from '@place/contracts/search'
import { publicPlaceDetailResponseSchema } from '@place/contracts/places'

type Dependencies = Readonly<{
  authorize(request: Request): Promise<Response>
  backendOrigin(): string | undefined
  request?: typeof fetch
}>
const headers = { 'cache-control': 'no-store', pragma: 'no-cache',
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
function problem(status: number, code: string): Response {
  return Response.json({ type: 'urn:place:error:admin-catalog', title: '장소 조회를 완료할 수 없습니다',
    status, code, retryable: status === 503, correlationRef: randomUUID() },
  { status, headers: { ...headers, 'content-type': 'application/problem+json' } })
}

async function readRequestBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > 8_192) throw new Error('Request too large')
  const reader = request.body?.getReader()
  if (reader === undefined) throw new Error('Body required')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      request.signal.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > 8_192) throw new Error('Request too large')
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { await reader.cancel().catch(() => undefined) }
}

/** Admin authentication is separate from the public-only catalog projection below. */
export function createAdminCatalogHttp(dependencies: Dependencies) {
  async function read(pathname: string, init: RequestInit, kind: 'search' | 'detail', signal: AbortSignal): Promise<Response> {
    const configured = dependencies.backendOrigin()
    if (configured === undefined) throw new Error('Backend unavailable')
    const origin = new URL(configured)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' ||
      origin.username !== '' || origin.password !== '' || origin.search !== '' || origin.hash !== '') {
      throw new Error('Backend configuration invalid')
    }
    // No bearer/cookie forwarded: administrative membership does not grant private place data.
    const result = await (dependencies.request ?? fetch)(new URL(pathname, origin), {
      ...init, cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    })
    if (!result.ok) {
      const status = [400, 404, 410].includes(result.status) ? result.status : 503
      return problem(status, status === 503 ? 'PLACE_ADMIN_CATALOG_UNAVAILABLE' : 'PLACE_ADMIN_CATALOG_REQUEST_FAILED')
    }
    const body = await result.json()
    const data = kind === 'search' ? catalogPlaceSearchResponseSchema.parse(body)
      : publicPlaceDetailResponseSchema.parse(body)
    return Response.json(data, { headers })
  }
  return {
    async search(request: Request): Promise<Response> {
      try {
        const access = await dependencies.authorize(request)
        if (!access.ok) return access
        if (request.headers.get('origin') !== new URL(request.url).origin) return problem(403, 'PLACE_ADMIN_ORIGIN_REQUIRED')
        let value: unknown
        try { value = await readRequestBody(request) } catch { return problem(400, 'PLACE_ADMIN_CATALOG_REQUEST_INVALID') }
        const parsed = catalogPlaceSearchRequestSchema.safeParse(value)
        if (!parsed.success) return problem(400, 'PLACE_ADMIN_CATALOG_REQUEST_INVALID')
        return await read('/v1/search/catalog', { method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(parsed.data) }, 'search', request.signal)
      } catch { return problem(503, 'PLACE_ADMIN_CATALOG_UNAVAILABLE') }
    },
    async detail(request: Request, placeId: string): Promise<Response> {
      try {
        const access = await dependencies.authorize(request)
        if (!access.ok) return access
        if (!publicPlaceDetailResponseSchema.shape.placeId.safeParse(placeId).success ||
          new URL(request.url).search !== '') return problem(400, 'PLACE_ADMIN_CATALOG_REQUEST_INVALID')
        return await read(`/v1/places/${encodeURIComponent(placeId)}`,
          { headers: { accept: 'application/json' } }, 'detail', request.signal)
      } catch { return problem(503, 'PLACE_ADMIN_CATALOG_UNAVAILABLE') }
    },
  }
}
