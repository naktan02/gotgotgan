import { describe, expect, it } from 'vitest'

import {
  NaverExtensionSavedPlaceSource,
  NaverProviderSession,
} from './naver-extension-saved-library.js'
import { NaverSavedPlaceCollector } from './naver-saved-place-collector.js'

function json(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}

describe('NAVER extension saved-library adapter', () => {
  it('preserves stable folder identity and both folder and bookmark order', async () => {
    const client = {
      get: async ({ url }: { url: URL }) => url.pathname.endsWith('/folders')
        ? json({ folderList: [{ shareID: 'folder-a', name: '후쿠오카 여행' }], totalCount: 1 })
        : json({ bookmarkList: [
          {
            bookmarkId: 'bookmark-a', sid: 'place-a', name: '라멘 A', displayName: '',
            address: '', mcidName: '',
          },
          { bookmarkId: 'bookmark-b', sid: 'place-b', name: '라멘 B' },
        ], totalCount: 2 }),
    }
    const collector = new NaverSavedPlaceCollector({
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      folderPageSize: 20,
      bookmarkPageSize: 100,
      maximumLists: 10,
      maximumBookmarks: 100,
      maximumResponseBytes: 1_048_576,
      delayMilliseconds: 0,
    })
    const source = new NaverExtensionSavedPlaceSource(collector, client)
    const captures = []
    for await (const capture of source.collect({ signal: AbortSignal.timeout(1_000) })) {
      captures.push(JSON.parse(capture.payload))
    }

    expect(captures).toEqual([expect.objectContaining({
      lists: [{
        listId: 'folder-a', name: '후쿠오카 여행', position: 0,
        bookmarks: [
          { bookmarkId: 'bookmark-a', placeId: 'place-a', name: '라멘 A', position: 0 },
          expect.objectContaining({ bookmarkId: 'bookmark-b', placeId: 'place-b', position: 1 }),
        ],
      }],
    })])
  })

  it('classifies an expired browser session without exposing its response', async () => {
    const session = new NaverProviderSession({
      get: async () => ({ status: 401, contentType: 'text/html', body: new Uint8Array() }),
    })
    await expect(session.probe({ signal: AbortSignal.timeout(1_000) })).resolves.toBe('reauth-required')
  })

  it('classifies Chrome opaque login redirects as reauthentication', async () => {
    const session = new NaverProviderSession({
      get: async () => ({ status: 0, contentType: '', body: new Uint8Array() }),
    })
    await expect(session.probe({ signal: AbortSignal.timeout(1_000) })).resolves.toBe('reauth-required')
  })

  it('classifies a successful NAVER login HTML response as reauthentication', async () => {
    const session = new NaverProviderSession({
      get: async () => ({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: new TextEncoder().encode('<html></html>'),
      }),
    })
    await expect(session.probe({ signal: AbortSignal.timeout(1_000) })).resolves.toBe('reauth-required')
  })

  it('emits one provider-valid finalizable capture for an empty saved library', async () => {
    const client = {
      get: async () => json({ folderList: [], totalCount: 0 }),
    }
    const collector = new NaverSavedPlaceCollector({
      apiBaseUrl: 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/',
      folderPageSize: 20,
      bookmarkPageSize: 100,
      maximumLists: 10,
      maximumBookmarks: 100,
      maximumResponseBytes: 1_048_576,
      delayMilliseconds: 0,
    })
    const source = new NaverExtensionSavedPlaceSource(collector, client)
    const captures = []
    for await (const capture of source.collect({ signal: AbortSignal.timeout(1_000) })) {
      captures.push({ ...capture, payload: JSON.parse(capture.payload) })
    }

    expect(captures).toEqual([{
      itemCount: 0,
      payload: {
        schemaVersion: 'place-naver-saved-capture.v1',
        kind: 'page', lists: [], nextCursor: null,
      },
    }])
  })
})
