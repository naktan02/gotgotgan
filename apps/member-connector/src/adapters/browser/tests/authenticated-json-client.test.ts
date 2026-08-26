import { describe, expect, it, vi } from 'vitest'

import {
  BrowserOriginPermissionDeniedError,
  WebExtensionAuthenticatedJsonClient,
} from '../webextensions/authenticated-json-client.js'

describe('WebExtensionAuthenticatedJsonClient', () => {
  it('requests only the configured origin and reuses browser credentials', async () => {
    const request = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
    }
    const client = new WebExtensionAuthenticatedJsonClient(
      'https://pages.map.naver.com', permissions, request,
    )
    const result = await client.get({
      url: new URL('https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/folders'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    })

    expect(permissions.request).toHaveBeenCalledWith({
      origins: ['https://pages.map.naver.com/*'],
    })
    expect(request).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/pages\.map\.naver\.com\//),
      expect.objectContaining({ credentials: 'include', redirect: 'manual' }))
    expect(new TextDecoder().decode(result.body)).toBe('{"ok":true}')
  })

  it('fails closed when the member denies the provider origin', async () => {
    const client = new WebExtensionAuthenticatedJsonClient(
      'https://pages.map.naver.com',
      { contains: async () => false, request: async () => false },
    )
    await expect(client.prepare()).rejects.toBeInstanceOf(BrowserOriginPermissionDeniedError)
  })
})
