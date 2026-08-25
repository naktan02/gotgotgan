import { describe, expect, it, vi } from 'vitest'

import {
  OfficialProviderHttpClient,
  ProviderRequestFailure,
} from '../index.js'

describe('official provider HTTP client', () => {
  it('retries bounded throttling and never follows redirects', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', {
        status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' },
      }))
      .mockResolvedValueOnce(new Response('{"ok":true}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    const sleep = vi.fn(async () => undefined)
    const client = new OfficialProviderHttpClient({ fetcher, sleep })

    await expect(client.request({
      method: 'GET', url: new URL('https://provider.example/search'), headers: {},
      timeoutMilliseconds: 1_000,
    })).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ redirect: 'error' }))
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('returns only safe error classes for authentication and malformed payloads', async () => {
    const authenticated = new OfficialProviderHttpClient({
      fetcher: async () => new Response('{"secret":"upstream-body"}', {
        status: 401, headers: { 'content-type': 'application/json' },
      }),
    })
    const malformed = new OfficialProviderHttpClient({
      fetcher: async () => new Response('not-json', {
        status: 200, headers: { 'content-type': 'text/plain' },
      }),
    })

    await expect(authenticated.request({
      method: 'GET', url: new URL('https://provider.example/search'), headers: {}, timeoutMilliseconds: 1_000,
    })).rejects.toEqual(new ProviderRequestFailure('PLACE_PROVIDER_AUTHENTICATION_FAILED'))
    await expect(malformed.request({
      method: 'GET', url: new URL('https://provider.example/search'), headers: {}, timeoutMilliseconds: 1_000,
    })).rejects.toEqual(new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID'))
    await expect(authenticated.request({
      method: 'GET', url: new URL('https://provider.example/search'), headers: {}, timeoutMilliseconds: 1_000,
    })).rejects.not.toThrow('upstream-body')
  })

  it('does not retry a rejected client request', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":"bad request"}', {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    const client = new OfficialProviderHttpClient({ fetcher })

    await expect(client.request({
      method: 'GET', url: new URL('https://provider.example/search'), headers: {},
      timeoutMilliseconds: 1_000,
    })).rejects.toEqual(new ProviderRequestFailure('PLACE_PROVIDER_RESPONSE_INVALID'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
