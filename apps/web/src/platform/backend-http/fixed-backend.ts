export type BackendEnvironment = Readonly<Record<string, string | undefined>>
export type BackendFetcher = (input: URL, init: RequestInit) => Promise<Response>

function backendOrigin(environment: BackendEnvironment): URL {
  const value = environment.PLACE_BACKEND_ORIGIN
  if (value === undefined) throw new Error('Place Backend is unavailable')
  const origin = new URL(value)
  if (
    !['http:', 'https:'].includes(origin.protocol) || origin.username !== '' ||
    origin.password !== '' || origin.pathname !== '/' || origin.search !== '' ||
    origin.hash !== ''
  ) throw new Error('Place Backend is unavailable')
  return origin
}

export function requestFixedBackend(
  pathname: string,
  init: Omit<RequestInit, 'cache' | 'redirect'>,
  environment: BackendEnvironment = process.env,
  fetcher: BackendFetcher = fetch,
): Promise<Response> {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error('Place Backend path is invalid')
  }
  return fetcher(new URL(pathname, backendOrigin(environment)), {
    ...init,
    cache: 'no-store',
    redirect: 'error',
  })
}
