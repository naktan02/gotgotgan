import { describe, expect, it, vi } from 'vitest'

import {
  NaverSharedListSource,
  PinnedNaverHttpsClient,
  type BoundedHttpResponse,
  type NaverSharedLinkHttpClient,
} from '../adapters/naver/shared-list-source.js'

function response(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = { 'content-type': 'application/json' },
): BoundedHttpResponse {
  return {
    status,
    headers,
    body: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function client(get: NaverSharedLinkHttpClient['get']): NaverSharedLinkHttpClient {
  return { get }
}

describe('NAVER shared-list source', () => {
  it('resolves a short link and normalizes paginated minimum place data', async () => {
    const get = vi.fn<NaverSharedLinkHttpClient['get']>(async ({ url }) => {
      if (url.hostname === 'naver.me') {
        return response('', 307, {
          location: 'https://map.naver.com/p/favorite/sharedPlace/folder/share-1',
          'content-type': 'text/html',
        })
      }
      const start = Number(url.searchParams.get('start'))
      return response({
        folder: { name: '서울 카페', shareId: 'share-1', bookmarkCount: 2 },
        bookmarkList: start === 0 ? [{
          bookmarkId: 11,
          sid: 'place-11',
          name: '카페 원본명',
          displayName: '조용한 카페',
          address: '서울시 중구',
          mcidName: '카페',
          px: 126.98,
          py: 37.56,
        }] : [{
          bookmarkId: '12',
          sid: null,
          name: '주소 없는 장소',
        }],
        totalCount: 2,
      })
    })
    const source = new NaverSharedListSource(client(get), { pageSize: 1 })

    const result = await source.inspect({
      entries: [{ entryId: 'entry-1', position: 0, url: 'https://naver.me/AbCd1234' }],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([expect.objectContaining({
      entryId: 'entry-1',
      status: 'succeeded',
      shareId: 'share-1',
      list: {
        sourceListId: 'share-1',
        observedName: '서울 카페',
        sourcePosition: 0,
        items: [{
          sourceItemId: '11',
          providerPlaceId: 'place-11',
          observedName: '조용한 카페',
          observedAddress: '서울시 중구',
          observedCategory: '카페',
          observedLocation: { latitude: 37.56, longitude: 126.98 },
          sourcePosition: 0,
        }, {
          sourceItemId: '12',
          providerPlaceId: null,
          observedName: '주소 없는 장소',
          observedAddress: null,
          observedCategory: null,
          observedLocation: null,
          sourcePosition: 1,
        }],
      },
    })])
    expect(get).toHaveBeenCalledTimes(3)
    expect(get.mock.calls[1]?.[0].url.pathname).toBe(
      '/save-pages/api/maps-bookmark/v3/shares/share-1/bookmarks',
    )
  })

  it('normalizes blank optional place text without emitting an invalid snapshot shape', async () => {
    const source = new NaverSharedListSource(client(async () => response({
      folder: { name: ' 목록 ' },
      bookmarkList: [{
        bookmarkId: 'item', name: ' 원본명 ', displayName: ' ', address: ' ', mcidName: ' ',
      }],
    })))

    const result = await source.inspect({
      entries: [{ entryId: 'entry', position: 0, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share' }],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([expect.objectContaining({
      status: 'succeeded',
      list: expect.objectContaining({
        observedName: '목록',
        items: [expect.objectContaining({
          observedName: '원본명', observedAddress: null, observedCategory: null,
        })],
      }),
    })])
  })

  it('keeps duplicate and failed links isolated from successful entries', async () => {
    const get = vi.fn<NaverSharedLinkHttpClient['get']>(async ({ url }) => {
      if (url.hostname === 'naver.me') {
        return response('', 307, {
          location: 'https://map.naver.com/p/favorite/sharedPlace/folder/share-1',
        })
      }
      if (url.pathname.includes('missing')) return response({}, 404)
      return response({
        folder: { name: '서울 카페', bookmarkCount: 0 },
        bookmarkList: [],
      })
    })
    const source = new NaverSharedListSource(client(get))

    const result = await source.inspect({
      entries: [
        { entryId: 'winner', position: 0, url: 'https://naver.me/AbCd1234' },
        { entryId: 'same-input', position: 1, url: 'https://naver.me/AbCd1234' },
        { entryId: 'same-share', position: 2, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share-1' },
        { entryId: 'missing', position: 3, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/missing' },
        { entryId: 'invalid', position: 4, url: 'https://127.0.0.1/admin' },
      ],
      signal: new AbortController().signal,
    })

    expect(result.map((item) => item.status)).toEqual([
      'succeeded', 'duplicate', 'duplicate', 'failed', 'failed',
    ])
    expect(result[1]).toMatchObject({ duplicateOfEntryId: 'winner' })
    expect(result[2]).toMatchObject({ duplicateOfEntryId: 'winner' })
    expect(result[3]).toMatchObject({ code: 'share-not-found', retryable: false })
    expect(result[4]).toMatchObject({ code: 'unsupported-host', retryable: false })
  })

  it('stops provider calls for the batch after the first rate-limit response', async () => {
    const get = vi.fn<NaverSharedLinkHttpClient['get']>(async () => response({}, 429))
    const source = new NaverSharedListSource(client(get))
    const result = await source.inspect({
      entries: Array.from({ length: 3 }, (_, position) => ({
        entryId: `entry-${position}`, position,
        url: `https://map.naver.com/p/favorite/sharedPlace/folder/share-${position}`,
      })),
      signal: new AbortController().signal,
    })

    expect(get).toHaveBeenCalledOnce()
    expect(result).toEqual(Array.from({ length: 3 }, (_, position) =>
      expect.objectContaining({
        entryId: `entry-${position}`, status: 'failed',
        code: 'provider-rate-limited', retryable: true,
      })))
  })

  it('fails closed on redirect escape, non-JSON responses, and aggregate item overflow', async () => {
    const redirectSource = new NaverSharedListSource(client(async () => response('', 307, {
      location: 'https://example.com/private',
    })))
    const driftSource = new NaverSharedListSource(client(async () => response(
      '<html>login</html>', 200, { 'content-type': 'text/html' },
    )))
    const overflowSource = new NaverSharedListSource(client(async () => response({
      folder: { name: '목록', bookmarkCount: 2 },
      bookmarkList: [
        { bookmarkId: '1', name: '하나' },
        { bookmarkId: '2', name: '둘' },
      ],
    })), { maximumItems: 1 })
    const listOverflowSource = new NaverSharedListSource(client(async () => response({
      folder: { name: '목록', bookmarkCount: 2 },
      bookmarkList: [
        { bookmarkId: '1', name: '하나' },
        { bookmarkId: '2', name: '둘' },
      ],
    })), { maximumListItems: 1, maximumItems: 10 })
    const input = {
      entries: [{ entryId: 'entry', position: 0, url: 'https://naver.me/AbCd1234' }],
      signal: new AbortController().signal,
    }

    await expect(redirectSource.inspect(input)).resolves.toEqual([
      expect.objectContaining({ status: 'failed', code: 'redirect-policy-denied' }),
    ])
    await expect(driftSource.inspect({
      entries: [{ ...input.entries[0]!, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share' }],
      signal: input.signal,
    })).resolves.toEqual([
      expect.objectContaining({ status: 'failed', code: 'provider-parser-drift' }),
    ])
    await expect(overflowSource.inspect({
      entries: [{ ...input.entries[0]!, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share' }],
      signal: input.signal,
    })).resolves.toEqual([
      expect.objectContaining({ status: 'failed', code: 'source-limit-exceeded' }),
    ])
    await expect(listOverflowSource.inspect({
      entries: [{ ...input.entries[0]!, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/share' }],
      signal: input.signal,
    })).resolves.toEqual([
      expect.objectContaining({ status: 'failed', code: 'source-limit-exceeded' }),
    ])
  })

  it('does not charge a failed oversized list against a later valid link in the same batch', async () => {
    const source = new NaverSharedListSource(client(async ({ url }) => response({
      folder: { name: url.pathname.includes('too-large') ? '너무 큰 목록' : '가져올 목록' },
      bookmarkList: url.pathname.includes('too-large')
        ? [{ bookmarkId: '1', name: '하나' }, { bookmarkId: '2', name: '둘' }]
        : [{ bookmarkId: '3', name: '셋' }],
    })), { maximumListItems: 1, maximumItems: 1 })

    const result = await source.inspect({
      entries: [
        { entryId: 'oversized', position: 0, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/too-large' },
        { entryId: 'valid', position: 1, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/valid' },
      ],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([
      expect.objectContaining({ entryId: 'oversized', status: 'failed', code: 'source-limit-exceeded' }),
      expect.objectContaining({ entryId: 'valid', status: 'succeeded' }),
    ])
  })

  it('keeps normalized aggregate bytes bounded with per-link partial failure', async () => {
    const source = new NaverSharedListSource(client(async ({ url }) => response({
      folder: { name: url.pathname.endsWith('/one') ? '첫 목록' : '둘째 목록' },
      bookmarkList: [{
        bookmarkId: url.pathname, name: '장소', address: '가'.repeat(500),
      }],
    })), { maximumNormalizedBytes: 2_800 } as never)

    const result = await source.inspect({
      entries: [
        { entryId: 'one', position: 0, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/one' },
        { entryId: 'two', position: 1, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/two' },
      ],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([
      expect.objectContaining({ entryId: 'one', status: 'succeeded' }),
      expect.objectContaining({ entryId: 'two', status: 'failed', code: 'source-limit-exceeded' }),
    ])
  })

  it('does not charge an aggregate-byte failure against a later small link item limit', async () => {
    const source = new NaverSharedListSource(client(async ({ url }) => response({
      folder: { name: url.pathname.includes('/shares/large/') ? '큰 목록' : '작은 목록' },
      bookmarkList: url.pathname.includes('/shares/large/')
        ? Array.from({ length: 2 }, (_, index) => ({
            bookmarkId: `large-${index}`, name: '장소', address: '가'.repeat(500),
          }))
        : [{ bookmarkId: 'small', name: '작은 장소' }],
    })), {
      maximumItems: 2,
      maximumListItems: 2,
      maximumNormalizedBytes: 1_600,
    } as never)

    const result = await source.inspect({
      entries: [
        { entryId: 'large', position: 0, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/large' },
        { entryId: 'small', position: 1, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/small' },
      ],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([
      expect.objectContaining({ entryId: 'large', status: 'failed', code: 'source-limit-exceeded' }),
      expect.objectContaining({ entryId: 'small', status: 'succeeded' }),
    ])
  })

  it('keeps worst-case valid fields below the 8 MiB durable JSONB envelope', async () => {
    const source = new NaverSharedListSource(client(async ({ url }) => {
      const shareId = url.pathname.split('/').at(-2)!
      return response({
        folder: { name: `목록-${shareId}`, bookmarkCount: 500 },
        totalCount: 500,
        bookmarkList: Array.from({ length: 500 }, (_, index) => ({
          bookmarkId: `${shareId}-${index}`,
          name: '가'.repeat(300), address: '나'.repeat(500), mcidName: '다'.repeat(300),
        })),
      })
    }))
    const result = await source.inspect({
      entries: Array.from({ length: 6 }, (_, position) => ({
        entryId: `entry-${position}`, position,
        url: `https://map.naver.com/p/favorite/sharedPlace/folder/share-${position}`,
      })),
      signal: new AbortController().signal,
    })

    expect(result.some((item) => item.status === 'succeeded')).toBe(true)
    expect(result.some((item) =>
      item.status === 'failed' && item.code === 'source-limit-exceeded')).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(8 * 1024 * 1024)
  })

  it('bounds pagination when a provider repeats a full page without making progress', async () => {
    const repeated = Array.from({ length: 200 }, (_, index) => ({
      bookmarkId: String(index), name: `장소 ${index}`,
    }))
    const source = new NaverSharedListSource(client(async () => response({
      folder: { name: '반복 목록' }, bookmarkList: repeated,
    })), { maximumPagesPerList: 2, maximumListItems: 500, maximumItems: 10_000 })

    const result = await source.inspect({
      entries: [{ entryId: 'entry', position: 0, url: 'https://map.naver.com/p/favorite/sharedPlace/folder/repeated' }],
      signal: new AbortController().signal,
    })

    expect(result).toEqual([
      expect.objectContaining({ status: 'failed', code: 'source-limit-exceeded' }),
    ])
  })

  it('rejects private or mixed DNS answers before opening an HTTPS request', async () => {
    const request = vi.fn()
    const input = {
      url: new URL('https://naver.me/AbCd1234'),
      maximumBytes: 1_024,
      timeoutMilliseconds: 1_000,
      signal: new AbortController().signal,
    }
    const privateClient = new PinnedNaverHttpsClient(
      async () => [{ address: '127.0.0.1', family: 4 }],
      request as unknown as typeof import('node:https').request,
    )
    const reboundClient = new PinnedNaverHttpsClient(
      async () => [
        { address: '203.1.1.1', family: 4 },
        { address: '::ffff:127.0.0.1', family: 6 },
      ],
      request as unknown as typeof import('node:https').request,
    )

    await expect(privateClient.get(input)).rejects.toMatchObject({
      code: 'redirect-policy-denied', retryable: false,
    })
    await expect(reboundClient.get(input)).rejects.toMatchObject({
      code: 'redirect-policy-denied', retryable: false,
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not let IPv6 mapped-address rules reject a public IPv4 DNS answer', async () => {
    const request = vi.fn(() => { throw new Error('opened-public-address') })
    const pinned = new PinnedNaverHttpsClient(
      async () => [{ address: '202.179.180.91', family: 4 }],
      request as unknown as typeof import('node:https').request,
    )

    await expect(pinned.get({
      url: new URL('https://naver.me/AbCd1234'),
      maximumBytes: 1_024,
      timeoutMilliseconds: 1_000,
      signal: new AbortController().signal,
    })).rejects.toThrow('opened-public-address')
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects reserved IPv4 and IPv6 DNS answers before opening an HTTPS request', async () => {
    const request = vi.fn()
    const input = {
      url: new URL('https://naver.me/AbCd1234'),
      maximumBytes: 1_024,
      timeoutMilliseconds: 1_000,
      signal: new AbortController().signal,
    }
    const reservedAddresses = [
      { address: '240.0.0.1', family: 4 },
      { address: '255.255.255.255', family: 4 },
      { address: '::203.1.1.1', family: 6 },
      { address: '::ffff:203.1.1.1', family: 6 },
      { address: '64:ff9b:1::1', family: 6 },
      { address: '100::1', family: 6 },
      { address: '2001::1', family: 6 },
      { address: '2001:2::1', family: 6 },
      { address: '2001:10::1', family: 6 },
      { address: '2001:20::1', family: 6 },
      { address: '2002::1', family: 6 },
      { address: '3fff::1', family: 6 },
      { address: '5f00::1', family: 6 },
      { address: 'fec0::1', family: 6 },
    ] as const

    for (const reserved of reservedAddresses) {
      const pinned = new PinnedNaverHttpsClient(
        async () => [reserved],
        request as unknown as typeof import('node:https').request,
      )
      await expect(pinned.get(input), reserved.address).rejects.toMatchObject({
        code: 'redirect-policy-denied', retryable: false,
      })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('does not open an HTTPS request when the caller aborts during DNS lookup', async () => {
    const request = vi.fn()
    const controller = new AbortController()
    let finishLookup!: (addresses: readonly { address: string; family: number }[]) => void
    const lookup = new Promise<readonly { address: string; family: number }[]>((resolve) => {
      finishLookup = resolve
    })
    const pinned = new PinnedNaverHttpsClient(
      async () => lookup,
      request as unknown as typeof import('node:https').request,
    )
    const pending = pinned.get({
      url: new URL('https://naver.me/AbCd1234'),
      maximumBytes: 1_024,
      timeoutMilliseconds: 1_000,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'request-timeout', retryable: true })
    finishLookup([{ address: '203.1.1.1', family: 4 }])
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })
})
