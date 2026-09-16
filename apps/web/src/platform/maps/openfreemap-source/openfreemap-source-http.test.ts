import { describe, expect, it, vi } from 'vitest'
import { serveOpenFreeMapSource } from './openfreemap-source-http'

const upstream = 'https://tiles.openfreemap.org/planet'
const optional = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
const required = '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
const metadata = { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], attribution: `${optional}${required}`, minzoom: 0, maxzoom: 14, extra: { future: true } }
const request = () => new Request('https://gotgotgan.example/api/maps/openfreemap-source', { headers: { cookie: 'private-cookie', authorization: 'private-token', 'x-upstream-url': 'http://127.0.0.1/' } })

describe('fixed public OpenFreeMap source metadata', () => {
  it('removes only the exact optional brand anchor and preserves future credits and all other metadata', async () => {
    const extra = ' <a href="https://example.org/license">New required credit</a>'
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ...metadata, attribution: metadata.attribution + extra }))
    const response = await serveOpenFreeMapSource(request(), fetcher)
    expect(await response.json()).toEqual({ ...metadata, attribution: required + extra })
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(upstream)
    const init = fetcher.mock.calls[0]![1]
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' } })
    expect(JSON.stringify(init)).not.toMatch(/private-cookie|private-token|127\.0\.0\.1/)
  })

  it('does not remove lookalikes or unknown OpenFreeMap attribution formats', async () => {
    const attribution = `${required} <a href="https://openfreemap.org.evil.example" target="_blank">OpenFreeMap</a> <a href="https://openfreemap.org" target="_blank">Additional OpenFreeMap credit</a>`
    const response = await serveOpenFreeMapSource(request(), async () => Response.json({ ...metadata, attribution }))
    expect((await response.json()).attribution).toBe(attribution)
  })

  it.each(['oversized', 'malformed', 'redirect', 'unavailable'] as const)('falls back only to the original fixed source on %s', async (failure) => {
    const response = await serveOpenFreeMapSource(request(), async () => {
      if (failure === 'unavailable') throw new Error('upstream unavailable')
      if (failure === 'oversized') return Response.json({ ...metadata, attribution: 'x'.repeat(256 * 1024) })
      if (failure === 'redirect') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } })
      return new Response('invalid-json', { headers: { 'content-type': 'application/json' } })
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(upstream)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not accept a query parameter as an upstream or forward a caller body', async () => {
    const fetcher = vi.fn()
    const response = await serveOpenFreeMapSource(new Request('https://gotgotgan.example/api/maps/openfreemap-source?url=http://127.0.0.1/'), fetcher)
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels a hanging response stream when the caller aborts', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const responsePromise = serveOpenFreeMapSource(new Request('https://gotgotgan.example/api/maps/openfreemap-source', { signal: controller.signal }), async () =>
      new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'application/json' } }))
    controller.abort()
    expect((await responsePromise).status).toBe(307)
    expect(cancelled).toHaveBeenCalled()
  })
})
