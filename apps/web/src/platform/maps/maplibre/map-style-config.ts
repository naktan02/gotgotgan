const OPEN_FREE_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LOCAL_E2E_STYLE_URL = '/api/maps/style'

function isSafeRelativeStyleUrl(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f]/u.test(value)
}

function isSafeHttpsStyleUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function resolvePlaceMapStyleUrl(
  configured: string | undefined,
  e2eBaseUrl: string | undefined,
): string {
  if (e2eBaseUrl !== undefined) return LOCAL_E2E_STYLE_URL
  if (configured === undefined || configured.trim() === '') {
    return OPEN_FREE_MAP_STYLE_URL
  }
  const value = configured.trim()
  if (value.length > 2_048 || (!isSafeRelativeStyleUrl(value) && !isSafeHttpsStyleUrl(value))) {
    throw new Error('PLACE_MAP_STYLE_URL must be a same-origin path or an HTTPS URL')
  }
  return value
}

export function readBrowserPlaceMapStyleUrl(documentRef: Document = document): string {
  const value = documentRef.body.dataset.placeMapStyleUrl
  return value === undefined || value === '' ? OPEN_FREE_MAP_STYLE_URL : value
}
