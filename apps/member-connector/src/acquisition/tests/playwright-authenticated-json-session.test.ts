import { describe, expect, it, vi } from 'vitest'

import { PlaywrightAuthenticatedJsonSession } from '../adapters/playwright/playwright-authenticated-json-session.js'

describe('authenticated member JSON session lifecycle', () => {
  it('shares only the dedicated browser cookie jar and always closes its context', async () => {
    const close = vi.fn(async () => undefined)
    const evaluate = vi.fn(async () => ({
      kind: 'response' as const,
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: '{"folderList":[]}',
    }))
    const page = { goto: vi.fn(async () => undefined), evaluate }
    const launchPersistentContext = vi.fn(async () => ({
      pages: () => [page],
      newPage: vi.fn(async () => page),
      close,
    }))
    const session = new PlaywrightAuthenticatedJsonSession({
      profileRoot: 'C:/private/member-profile',
      allowedOrigin: 'https://pages.map.naver.com',
      sessionUrl: 'https://pages.map.naver.com/save-pages/pc/all-list',
      requestTimeoutMilliseconds: 5_000,
      launchPersistentContext,
    })

    const result = await session.use((client) => client.get({
      url: new URL('https://pages.map.naver.com/api/folders?private=query'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    }))

    expect(result).toEqual({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: new TextEncoder().encode('{"folderList":[]}'),
    })
    expect(launchPersistentContext).toHaveBeenCalledWith(
      'C:/private/member-profile',
      { channel: 'chrome', headless: false, acceptDownloads: false },
    )
    expect(page.goto).toHaveBeenCalledWith(
      'https://pages.map.naver.com/save-pages/pc/all-list',
      { waitUntil: 'domcontentloaded', timeout: 5_000 },
    )
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), {
      url: 'https://pages.map.naver.com/api/folders?private=query',
      maximumBytes: 1_024,
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects another origin and oversized bodies without reading them', async () => {
    const close = vi.fn(async () => undefined)
    const evaluate = vi.fn(async () => ({ kind: 'too-large' as const }))
    const page = { goto: vi.fn(async () => undefined), evaluate }
    const session = new PlaywrightAuthenticatedJsonSession({
      profileRoot: 'C:/private/member-profile',
      allowedOrigin: 'https://pages.map.naver.com',
      sessionUrl: 'https://pages.map.naver.com/save-pages/pc/all-list',
      requestTimeoutMilliseconds: 5_000,
      launchPersistentContext: vi.fn(async () => ({
        pages: () => [page],
        newPage: vi.fn(async () => page),
        close,
      })),
    })

    await expect(session.use((client) => client.get({
      url: new URL('https://example.com/private'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    }))).rejects.toThrow('Authenticated member request is invalid')
    expect(evaluate).not.toHaveBeenCalled()

    await expect(session.use((client) => client.get({
      url: new URL('https://pages.map.naver.com/too-large'),
      maximumBytes: 1_024,
      signal: AbortSignal.timeout(1_000),
    }))).rejects.toThrow('Authenticated member response is too large')
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(2)
  })
})
