import { describe, expect, it, vi } from 'vitest'
import { createNaverDesktopAcquisitionProvider } from './acquisition-provider.js'
import { previewSavedLibrary } from '../../../../application/preview-saved-library.js'

describe('NAVER Desktop acquisition bundle', () => {
  it('reuses one operation client for authentication and shared source/normalizer consumption', async () => {
    const requests: URL[] = []
    const createClient = vi.fn(() => ({ get: async ({ url }: { url: URL }) => {
      requests.push(url)
      const body = url.pathname.endsWith('/folders')
        ? { folderList: [{ shareID: 'fixture-list', name: '검증 목록' }], totalCount: 1 }
        : { bookmarkList: [{ bookmarkId: 'fixture-bookmark', sid: 'fixture-place', name: '검증 장소', memo: 'excluded' }], totalCount: 1 }
      return { status: 200, contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify(body)) }
    } }))
    const provider = createNaverDesktopAcquisitionProvider(createClient)
    expect(provider.canProbeLogin('https://nid.naver.com/nidlogin.login')).toBe(false)
    expect(provider.canProbeLogin('https://map.naver.com/')).toBe(true)
    expect(provider.canProbeLogin('https://map.naver.com.evil.invalid/')).toBe(false)
    expect(await provider.acquisition.session.probe({ signal: new AbortController().signal })).toBe('active')
    const result = await previewSavedLibrary({ ...provider.acquisition, signal: new AbortController().signal })
    expect(result).toEqual({ listCount: 1, itemCount: 1, missingIdentityCount: 0, serverSaved: false })
    expect(createClient).toHaveBeenCalledOnce()
    expect(requests.map((url) => url.pathname)).toEqual([
      '/save-pages/api/maps-bookmark/v3/folders', '/save-pages/api/maps-bookmark/v3/folders',
      '/save-pages/api/maps-bookmark/v3/folders', '/save-pages/api/maps-bookmark/v3/shares/fixture-list/bookmarks',
    ])
    expect(JSON.stringify(result)).not.toMatch(/fixture|excluded|cookie|token/u)
    createNaverDesktopAcquisitionProvider(createClient)
    expect(createClient).toHaveBeenCalledTimes(2)
  })
})
