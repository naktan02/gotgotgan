import { afterEach, describe, expect, it, vi } from 'vitest'

import { ElectronAuthenticatedJsonClient } from '../authenticated-json-client.js'
import { allowsNaverLoginNavigation, allowsNaverSavedPlaceRequest, naverSavedPlaceApiBaseUrl } from '../../../providers/naver/api/request-policy.js'

const url = new URL('folders?start=0&limit=20&sort=lastUseTime&folderType=all', naverSavedPlaceApiBaseUrl)
const input = () => ({ url, maximumBytes: 100, signal: new AbortController().signal })
afterEach(() => vi.useRealTimers())

describe('Electron session-bound read transport', () => {
  it('allows only observed provider read endpoints and bounded pagination', () => {
    expect(allowsNaverSavedPlaceRequest(url)).toBe(true)
    expect(allowsNaverSavedPlaceRequest(new URL('shares/list-fixture-1/bookmarks?start=0&limit=100&sort=lastUseTime', naverSavedPlaceApiBaseUrl))).toBe(true)
    for (const value of [
      'https://pages.map.naver.com.evil.invalid/save-pages/api/maps-bookmark/v3/folders',
      `${url.href}&limit=100`, `${url.href}&other=1`, url.href.replace('limit=20', 'limit=999'),
      url.href.replace('/folders?', '/details?'), url.href.replace('/folders?', '/shares/%2F/bookmarks?'),
      'file:///private', 'http://localhost/', `${url.href}#fragment`,
    ]) expect(allowsNaverSavedPlaceRequest(new URL(value))).toBe(false)
    expect(allowsNaverLoginNavigation('https://nid.naver.com/nidlogin.login')).toBe(true)
    for (const value of ['https://naver.com.evil.invalid/', 'https://user:secret@nid.naver.com/', 'javascript:alert(1)', 'https://other.naver.com/']) {
      expect(allowsNaverLoginNavigation(value)).toBe(false)
    }
  })

  it('uses GET/session credentials without exposing cookies and refuses redirects', async () => {
    const fetcher = vi.fn(async () => Response.json({ folderList: [] }))
    const client = new ElectronAuthenticatedJsonClient(fetcher, allowsNaverSavedPlaceRequest)
    const response = await client.get(input())
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledWith(url.href, expect.objectContaining({
      method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store',
      headers: { accept: 'application/json' },
    }))
    expect(Object.keys(response).sort()).toEqual(['body', 'contentType', 'status'])
    await expect(client.get({ ...input(), url: new URL('https://evil.invalid/') })).rejects.toMatchObject({ code: 'permission-denied' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds streamed bytes and discards login or error bodies', async () => {
    const fetcher = vi.fn(async () => Response.json({ value: 'x'.repeat(200) }))
    const client = new ElectronAuthenticatedJsonClient(fetcher, allowsNaverSavedPlaceRequest)
    await expect(client.get(input())).rejects.toMatchObject({ code: 'response-too-large' })
    const loginClient = new ElectronAuthenticatedJsonClient(async () => new Response('private login data', {
      status: 403, headers: { 'content-type': 'text/html' },
    }), allowsNaverSavedPlaceRequest)
    expect((await loginClient.get(input())).body.byteLength).toBe(0)
  })

  it('aborts on timeout including a response body stalled after headers', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const client = new ElectronAuthenticatedJsonClient(async () => new Response(body, {
      headers: { 'content-type': 'application/json' },
    }), allowsNaverSavedPlaceRequest, 10)
    const pending = expect(client.get(input())).rejects.toMatchObject({ code: 'transport-unavailable' })
    await vi.advanceTimersByTimeAsync(10)
    await pending
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('bounds aggregate response bytes before the full-library parser retains every page', async () => {
    const fetcher = vi.fn(async () => Response.json({ value: '12345' }))
    const client = new ElectronAuthenticatedJsonClient(fetcher, allowsNaverSavedPlaceRequest, 1000, 30)
    await client.get(input())
    await expect(client.get(input())).rejects.toMatchObject({ code: 'response-too-large' })
    await expect(client.get(input())).rejects.toMatchObject({ code: 'response-too-large' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not issue a request after prior cancellation and sanitizes transport errors', async () => {
    const fetcher = vi.fn(async () => { throw new Error('secret provider URL or token') })
    const client = new ElectronAuthenticatedJsonClient(fetcher, allowsNaverSavedPlaceRequest)
    const controller = new AbortController(); controller.abort()
    await expect(client.get({ ...input(), signal: controller.signal })).rejects.toMatchObject({ code: 'transport-unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(client.get(input())).rejects.toThrow('Provider request was interrupted or unavailable.')
  })
})
