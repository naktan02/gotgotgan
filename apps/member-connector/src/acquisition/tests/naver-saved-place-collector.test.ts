import { describe, expect, it, vi } from 'vitest'

import { NaverSavedPlaceCollector } from '../../adapters/providers/naver/naver-saved-place-collector.js'

function json(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}

describe('NAVER member saved-place collector', () => {
  it('paginates every folder and bookmark page without dropping personal source fields', async () => {
    const get = vi.fn(async ({ url }: { url: URL }) => {
      const start = Number(url.searchParams.get('start'))
      if (url.pathname.endsWith('/folders')) {
        return json({
          folderList: start === 0
            ? [{ shareID: 'list-a', name: '식당' }, { shareID: 'list-b', name: '여행' }]
            : [{ shareID: 'list-c', name: '카페' }],
          totalCount: 3,
        })
      }
      const listId = url.pathname.split('/').at(-2)
      if (listId === 'list-a' && start === 0) return json({
        bookmarks: [{
          bookmarkId: 101,
          sid: 'place-101',
          name: '장소 A',
          displayName: '별칭 A',
          px: 126.9,
          py: 37.5,
          type: 'place',
          creationTime: 1_700_000_000_000,
          lastUpdateTime: 1_700_000_100_000,
          useTime: 1_700_000_200_000,
          address: '주소 A',
          memo: '개인 메모 A',
          url: 'https://example.invalid/a',
          mcid: 'DINING',
          mcidName: '음식점',
          rcode: 'region-a',
          cidPath: ['category-a'],
          available: true,
          isIndoor: false,
        }, {
          bookmarkId: '102',
          name: '장소 B',
        }],
        count: 3,
      })
      if (listId === 'list-a') return json({
        bookmarkList: [{ bookmarkId: 103, sid: 203, name: '장소 C' }],
        totalCount: 3,
      })
      return json({ bookmarkList: [], totalCount: 0 })
    })
    const collector = new NaverSavedPlaceCollector({
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      folderPageSize: 2,
      bookmarkPageSize: 2,
      maximumLists: 10,
      maximumBookmarks: 20,
      maximumResponseBytes: 1_048_576,
      delayMilliseconds: 0,
    })

    const result = await collector.collectAll({
      client: { get },
      signal: AbortSignal.timeout(1_000),
    })

    expect(result.summary).toEqual({ listCount: 3, bookmarkCount: 3, requestCount: 6 })
    expect(result.lists[0]).toEqual({
      listId: 'list-a',
      name: '식당',
      bookmarks: [expect.objectContaining({
        bookmarkId: '101',
        providerPlaceId: 'place-101',
        name: '장소 A',
        displayName: '별칭 A',
        longitude: 126.9,
        latitude: 37.5,
        memo: '개인 메모 A',
        categoryCode: 'DINING',
        categoryLabel: '음식점',
        categoryPath: ['category-a'],
        available: true,
      }), expect.objectContaining({ bookmarkId: '102', name: '장소 B' }),
      expect.objectContaining({ bookmarkId: '103', providerPlaceId: '203' })],
    })
    expect(get).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.objectContaining({ origin: 'https://pages.map.naver.com' }),
      maximumBytes: 1_048_576,
    }))
  })

  it.each([302, 401, 403, 405])('classifies HTTP %i as a user-action boundary', async (status) => {
    const base = {
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      folderPageSize: 20,
      bookmarkPageSize: 100,
      maximumLists: 1,
      maximumBookmarks: 10,
      maximumResponseBytes: 1_048_576,
      delayMilliseconds: 0,
    }
    await expect(new NaverSavedPlaceCollector(base).collectAll({
      client: { get: async () => ({
        status,
        contentType: 'text/html',
        body: new TextEncoder().encode('<html>login</html>'),
      }) },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow('NAVER saved-place collection requires user action')
  })

  it('fails closed on schema drift and collection caps', async () => {
    const base = {
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      folderPageSize: 20,
      bookmarkPageSize: 100,
      maximumLists: 1,
      maximumBookmarks: 10,
      maximumResponseBytes: 1_048_576,
      delayMilliseconds: 0,
    }

    await expect(new NaverSavedPlaceCollector(base).collectAll({
      client: { get: async () => json({ unknown: true }) },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow('NAVER saved-place response schema changed')

    await expect(new NaverSavedPlaceCollector(base).collectAll({
      client: { get: async () => json({
        folderList: [
          { shareID: 'list-a', name: 'A' },
          { shareID: 'list-b', name: 'B' },
        ],
      }) },
      signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow('NAVER saved-place collection exceeded configured limits')
  })
})
