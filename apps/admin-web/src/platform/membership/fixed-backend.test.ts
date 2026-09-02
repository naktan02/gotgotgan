import { describe, expect, it, vi } from 'vitest'

import { createFixedBackendClient } from './fixed-backend'

describe('fixed admin Backend client', () => {
  it('calls only the configured origin and keeps the bearer token server-side', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const client = createFixedBackendClient({
      origin: 'https://backend.example/',
      timeoutMilliseconds: 1_000,
      request,
    })

    await client.currentMembership('server-token')

    expect(request).toHaveBeenCalledOnce()
    const [url, init] = request.mock.calls[0]!
    expect(String(url)).toBe('https://backend.example/v1/me')
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-token')
  })

  it.each([
    'javascript:alert(1)',
    'https://user:secret@backend.example/',
    'https://backend.example/path',
    'https://backend.example/?next=other',
  ])('rejects unsafe Backend origins: %s', (origin) => {
    expect(() => createFixedBackendClient({ origin })).toThrow('configuration is invalid')
  })
})
