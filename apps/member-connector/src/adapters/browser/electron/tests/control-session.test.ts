import { describe, expect, it, vi } from 'vitest'

import { DesktopControlSession, desktopControlUrl, isTrustedControlSender } from '../control-session.js'
import { previewSavedLibrary } from '../../../../application/preview-saved-library.js'
import { NaverApiSavedPlaceSource, NaverProviderSession } from '../../../providers/naver/api/saved-place-source.js'
import { NaverSavedPlaceCollector } from '../../../providers/naver/api/saved-place-collector.js'
import { naverSavedPlaceApiBaseUrl } from '../../../providers/naver/api/request-policy.js'
import { NaverSavedPlaceSnapshotNormalizer } from '../../../providers/naver/snapshot/saved-place-snapshot-normalizer.js'

const summary = { listCount: 1, itemCount: 1, missingIdentityCount: 0, serverSaved: false as const }

describe('Desktop login and capture lifecycle', () => {
  it('accepts only the exact local main-frame sender', () => {
    const sender = { expectedContentsId: 2, contentsId: 2, frameUrl: desktopControlUrl, mainFrame: true }
    expect(isTrustedControlSender(sender)).toBe(true)
    for (const change of [{ contentsId: 3 }, { frameUrl: 'https://map.naver.com/' },
      { mainFrame: false }, { frameUrl: `${desktopControlUrl}?spoof=1` }]) {
      expect(isTrustedControlSender({ ...sender, ...change })).toBe(false)
    }
  })

  it('never collects during visible login and does not claim login success from closing', async () => {
    let close!: () => void
    const collect = vi.fn(async () => summary)
    const workflow = new DesktopControlSession({
      login: () => new Promise<void>((resolve) => { close = resolve }), closeLogin: () => close(), collect,
    })
    expect((await workflow.execute('collect')).state).toBe('error')
    const login = workflow.execute('login')
    expect((await workflow.execute('collect')).state).toBe('busy')
    expect(collect).not.toHaveBeenCalled()
    close()
    expect(await login).toMatchObject({ state: 'login-closed' })
    expect(await workflow.execute('collect')).toEqual({ state: 'collected', summary })
    expect(await workflow.execute({ url: 'https://evil.invalid/' })).toMatchObject({ state: 'error' })
  })

  it('cancels login without letting its delayed completion enable collection', async () => {
    let close!: () => void
    const collect = vi.fn(async () => summary)
    const workflow = new DesktopControlSession({
      login: () => new Promise<void>((resolve) => { close = resolve }), closeLogin: () => close(), collect,
    })
    const login = workflow.execute('login')
    await workflow.execute('cancel')
    expect((await login).state).toBe('cancelled')
    expect((await workflow.execute('collect')).state).toBe('error')
    expect(collect).not.toHaveBeenCalled()
  })

  it('aborts acquisition on close and rejects commands after shutdown', async () => {
    const workflow = new DesktopControlSession({ login: async () => {}, closeLogin: () => {},
      collect: (signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(summary), { once: true })),
    })
    await workflow.execute('login')
    const collecting = workflow.execute('collect')
    workflow.close()
    expect((await collecting).state).toBe('cancelled')
    expect((await workflow.execute('login')).state).toBe('error')
  })

  it('reuses the real NAVER parser and normalizer for folders then minimum bookmarks only', async () => {
    const paths: string[] = []
    const client = { get: async ({ url }: { url: URL }) => {
      paths.push(url.pathname)
      const data = url.pathname.endsWith('/folders')
        ? { folderList: [{ shareID: 'list-fixture', name: '검증 목록' }], totalCount: 1 }
        : { bookmarkList: [{ bookmarkId: 'bookmark-fixture', sid: 'place-fixture', name: '검증 장소', memo: 'private ignored' }], totalCount: 1 }
      return { status: 200, contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify(data)) }
    } }
    const collector = new NaverSavedPlaceCollector({
      apiBaseUrl: naverSavedPlaceApiBaseUrl, folderPageSize: 20, bookmarkPageSize: 100,
      maximumLists: 500, maximumBookmarks: 100_000, maximumResponseBytes: 4_194_304, delayMilliseconds: 0,
    })
    const result = await previewSavedLibrary({
      source: new NaverApiSavedPlaceSource(collector, client), session: new NaverProviderSession(client),
      normalizer: new NaverSavedPlaceSnapshotNormalizer(), signal: new AbortController().signal,
    })
    expect(result).toEqual(summary)
    expect(paths).toEqual([
      '/save-pages/api/maps-bookmark/v3/folders', '/save-pages/api/maps-bookmark/v3/folders',
      '/save-pages/api/maps-bookmark/v3/shares/list-fixture/bookmarks',
    ])
    expect(JSON.stringify(result)).not.toMatch(/fixture|private|cookie|token/u)
  })
})
