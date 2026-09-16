import { OPEN_FREE_MAP_SOURCE_URL } from './source-location'

const maximumBytes = 256 * 1024
const optionalBrandAnchor = /<a href="https:\/\/openfreemap\.org\/?" target="_blank">OpenFreeMap<\/a>[ \t]*/g
type SourceFetcher = (url: string, init: RequestInit) => Promise<Response>

async function readMetadata(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' ||
    Number(response.headers.get('content-length') ?? 0) > maximumBytes || response.body === null) {
    await response.body?.cancel()
    throw new Error('source metadata is unavailable')
  }
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (signal.aborted) throw new Error('source metadata request expired')
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximumBytes) throw new Error('source metadata is too large')
      chunks.push(next.value)
    }
    if (signal.aborted) throw new Error('source metadata request expired')
    const body = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata) ||
      !('attribution' in metadata) || typeof metadata.attribution !== 'string' ||
      !('tiles' in metadata) || !Array.isArray(metadata.tiles) || !metadata.tiles.every((tile) => typeof tile === 'string')) {
      throw new Error('source metadata is invalid')
    }
    return { ...metadata, attribution: metadata.attribution.replace(optionalBrandAnchor, '') }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** One fixed public TileJSON, not a general URL proxy. Never forwards caller credentials. */
export async function serveOpenFreeMapSource(request: Request, fetcher: SourceFetcher = fetch): Promise<Response> {
  if (request.method !== 'GET' || new URL(request.url).search !== '') {
    return new Response(null, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)])
  try {
    const upstream = await fetcher(OPEN_FREE_MAP_SOURCE_URL, {
      headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
    })
    return Response.json(await readMetadata(upstream, signal), {
      headers: { 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' },
    })
  } catch {
    // Brand suppression is optional. The browser can still load the original source,
    // including all upstream credits, if this small metadata boundary is unavailable.
    return new Response(null, { status: 307, headers: {
      location: OPEN_FREE_MAP_SOURCE_URL, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    } })
  }
}
