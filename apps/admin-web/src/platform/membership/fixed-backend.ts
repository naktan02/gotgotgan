export type FixedBackendClient = Readonly<{
  ready(): Promise<Response>
  currentMembership(accessToken: string): Promise<Response>
}>

export type FixedBackendClientConfig = Readonly<{
  origin: string
  timeoutMilliseconds?: number
  request?: typeof fetch
}>

function parseOrigin(value: string): URL {
  let origin: URL
  try {
    origin = new URL(value)
  } catch {
    throw new Error('Admin Backend configuration is invalid')
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new Error('Admin Backend configuration is invalid')
  }
  return origin
}

export function createFixedBackendClient(config: FixedBackendClientConfig): FixedBackendClient {
  const origin = parseOrigin(config.origin)
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0 ||
    timeoutMilliseconds > 60_000
  ) {
    throw new Error('Admin Backend configuration is invalid')
  }
  const request = config.request ?? fetch
  const send = (pathname: '/readyz' | '/v1/me', init: RequestInit) => request(
    new URL(pathname, origin),
    {
      ...init,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMilliseconds),
    },
  )

  return {
    ready: () => send('/readyz', {}),
    currentMembership: (accessToken) => send('/v1/me', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    }),
  }
}

export function createConfiguredFixedBackendClient(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  request?: typeof fetch,
): FixedBackendClient {
  const origin = environment.PLACE_BACKEND_ORIGIN
  if (origin === undefined) throw new Error('Admin Backend is unavailable')
  const configuredTimeout = environment.PLACE_ADMIN_BACKEND_TIMEOUT_MILLISECONDS
  const timeoutMilliseconds = configuredTimeout === undefined ? 5_000 : Number(configuredTimeout)
  return createFixedBackendClient({ origin, timeoutMilliseconds, request })
}
