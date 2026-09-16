import { describe, expect, it } from 'vitest'

import { readOperationJson } from './operation-json-envelope'

describe('operation JSON envelope', () => {
  it('stops an undeclared stream when its actual byte limit is exceeded', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'))
        controller.enqueue(new TextEncoder().encode('larger-than-the-limit'))
      },
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'application/json' } })

    await expect(readOperationJson(response, 12)).resolves.toEqual({ status: 'too-large' })
    expect(cancelled).toBe(true)
  })

  it('rejects declared oversized bodies without consuming their stream', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{}')) },
    }), {
      headers: { 'content-type': 'application/json', 'content-length': '65' },
    })

    await expect(readOperationJson(response, 64)).resolves.toEqual({ status: 'too-large' })
    expect(response.body?.locked).toBe(false)
  })

  it('rejects compressed, malformed, and non-JSON envelopes', async () => {
    const compressed = new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    })
    const malformed = new Response('{', { headers: { 'content-type': 'application/json' } })
    const text = new Response('{}', { headers: { 'content-type': 'text/plain' } })

    await expect(readOperationJson(compressed, 64)).resolves.toEqual({ status: 'invalid' })
    await expect(readOperationJson(malformed, 64)).resolves.toEqual({ status: 'invalid' })
    await expect(readOperationJson(text, 64)).resolves.toEqual({ status: 'invalid' })
  })

  it('cancels a stalled stream when its caller is aborted', async () => {
    let cancelled = false
    const controller = new AbortController()
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'application/json' } })

    const read = readOperationJson(response, 64, controller.signal)
    controller.abort()

    await expect(read).resolves.toEqual({ status: 'invalid' })
    expect(cancelled).toBe(true)
  })
})
