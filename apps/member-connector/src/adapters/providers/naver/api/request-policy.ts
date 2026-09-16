export const naverSavedPlaceApiBaseUrl = 'https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/'
export const naverMemberPageUrl = 'https://map.naver.com/'

export function allowsNaverLoginNavigation(value: string): boolean {
  try {
    const url = new URL(value)
    return url.username === '' && url.password === '' &&
      new Set(['https://map.naver.com', 'https://pages.map.naver.com', 'https://nid.naver.com']).has(url.origin)
  } catch { return false }
}

/** Only the two already-observed read endpoints, with bounded collector pagination. */
export function allowsNaverSavedPlaceRequest(url: URL): boolean {
  const base = new URL(naverSavedPlaceApiBaseUrl)
  if (url.origin !== base.origin || url.username !== '' || url.password !== '' || url.hash !== '') return false
  const path = url.pathname.slice(base.pathname.length)
  if (!url.pathname.startsWith(base.pathname)) return false
  const folders = path === 'folders'
  if (!folders && !/^shares\/[A-Za-z0-9_-]{1,512}\/bookmarks$/u.test(path)) return false
  const keys = folders ? ['start', 'limit', 'sort', 'folderType'] : ['start', 'limit', 'sort']
  if ([...url.searchParams.keys()].length !== keys.length) return false
  if (keys.some((key) => url.searchParams.getAll(key).length !== 1)) return false
  const start = url.searchParams.get('start') ?? ''
  const limit = url.searchParams.get('limit') ?? ''
  return /^\d{1,6}$/u.test(start) && Number(start) <= 100_000 &&
    /^\d{1,3}$/u.test(limit) && Number(limit) >= 1 && Number(limit) <= 500 &&
    url.searchParams.get('sort') === 'lastUseTime' &&
    (!folders || url.searchParams.get('folderType') === 'all')
}
