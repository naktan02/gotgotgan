import { describe, expect, it } from 'vitest'

import { readBoundedJson } from './bounded-json'

describe('bounded JSON reader', () => {
  it('stops an undeclared stream once its actual byte limit is exceeded', async () => {
    const request = new Request('https://place.example/api/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'larger-than-the-limit' }),
    })
    await expect(readBoundedJson(request, 8)).resolves.toEqual({ status: 'too-large' })
  })

  it('rejects compressed, malformed, and non-JSON bodies', async () => {
    const compressed = new Request('https://place.example/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: '{}',
    })
    const malformed = new Response('{', { headers: { 'content-type': 'application/json' } })
    const text = new Response('{}', { headers: { 'content-type': 'text/plain' } })

    await expect(readBoundedJson(compressed, 64)).resolves.toEqual({ status: 'invalid' })
    await expect(readBoundedJson(malformed, 64)).resolves.toEqual({ status: 'invalid' })
    await expect(readBoundedJson(text, 64)).resolves.toEqual({ status: 'invalid' })
  })
})
