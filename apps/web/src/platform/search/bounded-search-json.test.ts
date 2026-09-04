import { describe, expect, it, vi } from 'vitest'

import {
  BoundedSearchJsonError,
  readBoundedSearchJson,
} from './bounded-search-json'

describe('bounded Search JSON', () => {
  it('reads a bounded JSON message', async () => {
    await expect(readBoundedSearchJson(Response.json({ ok: true }), 64)).resolves.toEqual({ ok: true })
  })

  it('rejects oversized content-length before reading', async () => {
    const response = new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '65' },
    })
    await expect(readBoundedSearchJson(response, 64)).rejects.toBeInstanceOf(BoundedSearchJsonError)
    expect(response.bodyUsed).toBe(true)
  })

  it('cancels a chunked stream as soon as it exceeds the cap', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"0123456789"}'))
      },
      cancel,
    })
    const response = new Response(stream, { headers: { 'content-type': 'application/json' } })
    await expect(readBoundedSearchJson(response, 8)).rejects.toBeInstanceOf(BoundedSearchJsonError)
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects compressed, malformed, and non-JSON messages', async () => {
    await expect(readBoundedSearchJson(new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    }), 64)).rejects.toBeInstanceOf(BoundedSearchJsonError)
    await expect(readBoundedSearchJson(new Response('{', {
      headers: { 'content-type': 'application/json' },
    }), 64)).rejects.toBeInstanceOf(BoundedSearchJsonError)
    await expect(readBoundedSearchJson(new Response('{}', {
      headers: { 'content-type': 'text/plain' },
    }), 64)).rejects.toBeInstanceOf(BoundedSearchJsonError)
  })
})
