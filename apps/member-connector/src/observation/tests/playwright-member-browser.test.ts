import { describe, expect, it, vi } from 'vitest'

import { PlaywrightMemberBrowser } from '../adapters/playwright/playwright-member-browser.js'

describe('visible member browser lifecycle', () => {
  it('collects only bounded response bodies and always closes its dedicated context', async () => {
    let responseListener: ((response: unknown) => void) | undefined
    const close = vi.fn(async () => undefined)
    const allowedBody = vi.fn(async () => Buffer.from(JSON.stringify({ lists: [] })))
    const discoveryBody = vi.fn(async () => Buffer.from(JSON.stringify({ private: 'value' })))
    const page = {
      evaluate: vi.fn(async () => undefined),
      goto: vi.fn(async () => {
        responseListener?.({
          url: () => 'https://map.naver.com/api/bookmarks?cursor=secret',
          status: () => 200,
          headers: () => ({
            'content-type': 'application/json; charset=utf-8',
            'content-length': '12',
          }),
          request: () => ({ method: () => 'GET' }),
          body: allowedBody,
        })
        responseListener?.({
          url: () => 'https://new-api.place.naver.com/discovery?private=value',
          status: () => 204,
          headers: () => ({ 'content-type': 'application/json' }),
          request: () => ({ method: () => 'POST' }),
          body: discoveryBody,
        })
      }),
    }
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      on: vi.fn((event: string, listener: (value: unknown) => void) => {
        if (event === 'response') responseListener = listener
      }),
      off: vi.fn(),
      close,
    }
    const launchPersistentContext = vi.fn(async () => context)
    const times = [
      new Date('2026-08-26T15:00:00.000Z'),
      new Date('2026-08-26T15:00:05.000Z'),
    ]
    const browser = new PlaywrightMemberBrowser({
      profileRoot: 'C:/private/place-member-profile',
      observationMilliseconds: 1,
      launchPersistentContext,
      now: () => times.shift()!,
    })

    await expect(browser.observe({
      targetUrl: 'https://map.naver.com/',
      allowedOrigins: ['https://map.naver.com'],
      metadataHostSuffix: 'naver.com',
      requestUrl: 'https://map.naver.com/api/bookmarks?start=0',
      maximumBodyBytes: 65_536,
      signal: AbortSignal.timeout(1_000),
    })).resolves.toEqual({
      startedAt: '2026-08-26T15:00:00.000Z',
      finishedAt: '2026-08-26T15:00:05.000Z',
      responses: [{
        method: 'GET',
        url: 'https://map.naver.com/api/bookmarks?cursor=secret',
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: { lists: [] },
      }, {
        method: 'POST',
        url: 'https://new-api.place.naver.com/discovery?private=value',
        status: 204,
        contentType: 'application/json',
      }],
    })
    expect(launchPersistentContext).toHaveBeenCalledWith(
      'C:/private/place-member-profile',
      expect.objectContaining({ channel: 'chrome', headless: false }),
    )
    expect(allowedBody).toHaveBeenCalledTimes(1)
    expect(discoveryBody).not.toHaveBeenCalled()
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'https://map.naver.com/api/bookmarks?start=0')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('opens login with capture disabled and closes the profile when cancelled', async () => {
    const close = vi.fn(async () => undefined)
    const page = { goto: vi.fn(async () => undefined), evaluate: vi.fn(async () => undefined) }
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      on: vi.fn(),
      off: vi.fn(),
      close,
    }
    const controller = new AbortController()
    controller.abort()
    const browser = new PlaywrightMemberBrowser({
      profileRoot: 'C:/private/place-member-profile',
      observationMilliseconds: 1,
      launchPersistentContext: vi.fn(async () => context),
    })

    await expect(browser.openLogin({
      targetUrl: 'https://map.naver.com/',
      signal: controller.signal,
    })).resolves.toEqual({ status: 'cancelled' })
    expect(page.goto).toHaveBeenCalledWith(
      'https://map.naver.com/',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    )
    expect(context.on).not.toHaveBeenCalledWith('response', expect.anything())
    expect(close).toHaveBeenCalledTimes(1)
  })
})
