export type ConnectorBackendClientConfig = Readonly<{
  origin: string
  timeoutMilliseconds: number
  request?: (input: URL, init: RequestInit) => Promise<Response>
}>

function configurationError(): Error {
  return new Error('Connector backend configuration is invalid')
}

export function createConnectorBackendClient(config: ConnectorBackendClientConfig) {
  let origin: URL
  try {
    origin = new URL(config.origin)
  } catch {
    throw configurationError()
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username !== '' || origin.password !== '' || origin.pathname !== '/' ||
    origin.search !== '' || origin.hash !== '' ||
    !Number.isInteger(config.timeoutMilliseconds) || config.timeoutMilliseconds <= 0 ||
    config.timeoutMilliseconds > 60_000
  ) throw configurationError()

  const request = config.request ?? fetch
  const send = (
    pathname: '/v1/connector-grants' | '/v1/connector-captures',
    authorization: string,
    body: unknown,
    publicOrigin?: string,
  ) => request(new URL(pathname, origin), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization,
      'content-type': 'application/json',
      ...(publicOrigin === undefined ? {} : { 'x-place-public-origin': publicOrigin }),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMilliseconds),
  })

  return {
    ready: () => request(new URL('/readyz', origin), {
      cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMilliseconds),
    }),
    issueGrant: (accessToken: string, body: unknown, publicOrigin: string) =>
      send('/v1/connector-grants', `Bearer ${accessToken}`, body, publicOrigin),
    submitCapture: (authorization: string, body: unknown, publicOrigin: string) =>
      send('/v1/connector-captures', authorization, body, publicOrigin),
  }
}
