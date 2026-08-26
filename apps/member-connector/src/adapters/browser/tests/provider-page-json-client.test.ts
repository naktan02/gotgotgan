import { describe, expect, it, vi } from 'vitest'

import {
  BrowserOriginPermissionDeniedError,
  WebExtensionProviderPageJsonClient,
} from '../webextensions/provider-page-json-client.js'

function clientDependencies(result: Readonly<{
  kind: 'response'
  status: number
  contentType: string
  bodyText: string
}> = {
  kind: 'response',
  status: 200,
  contentType: 'application/json',
  bodyText: '{"ok":true}',
}) {
  return {
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    tabs: {
      query: vi.fn(async () => [{
        id: 7,
        status: 'complete',
        url: 'https://pages.map.naver.com/save-pages/pc/all-list',
      }]),
      create: vi.fn(async () => ({ id: 8, status: 'complete' })),
      get: vi.fn(async () => ({ id: 7, status: 'complete' })),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result }]),
    },
  }
}

describe('WebExtensionProviderPageJsonClient', () => {
  it('executes an exact-origin request in the isolated world of a provider page', async () => {
    const dependencies = clientDependencies()
    const client = new WebExtensionProviderPageJsonClient(
      'https://pages.map.naver.com',
      'https://pages.map.naver.com/save-pages/pc/all-list',
      dependencies.permissions,
      dependencies.tabs,
      dependencies.scripting,
    )
    const result = await client.get({
      url: new URL('https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/folders'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    })

    expect(dependencies.tabs.query).toHaveBeenCalledWith({
      url: ['https://pages.map.naver.com/*'],
    })
    expect(dependencies.tabs.create).not.toHaveBeenCalled()
    expect(dependencies.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 },
      world: 'ISOLATED',
      args: [
        'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/folders',
        1_024,
      ],
      func: expect.any(Function),
    }))
    expect(new TextDecoder().decode(result.body)).toBe('{"ok":true}')
  })

  it('opens a provider page when no eligible tab exists', async () => {
    const dependencies = clientDependencies()
    dependencies.tabs.query.mockResolvedValue([])
    const client = new WebExtensionProviderPageJsonClient(
      'https://pages.map.naver.com',
      'https://pages.map.naver.com/save-pages/pc/all-list',
      dependencies.permissions,
      dependencies.tabs,
      dependencies.scripting,
    )

    await client.get({
      url: new URL('https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/folders'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    })

    expect(dependencies.tabs.create).toHaveBeenCalledWith({
      active: false,
      url: 'https://pages.map.naver.com/save-pages/pc/all-list',
    })
    expect(dependencies.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8 },
    }))
  })

  it('fails closed when the member denies the provider origin', async () => {
    const dependencies = clientDependencies()
    dependencies.permissions.contains.mockResolvedValue(false)
    dependencies.permissions.request.mockResolvedValue(false)
    const client = new WebExtensionProviderPageJsonClient(
      'https://pages.map.naver.com',
      'https://pages.map.naver.com/save-pages/pc/all-list',
      dependencies.permissions,
      dependencies.tabs,
      dependencies.scripting,
    )

    await expect(client.prepare()).rejects.toBeInstanceOf(BrowserOriginPermissionDeniedError)
  })
})
