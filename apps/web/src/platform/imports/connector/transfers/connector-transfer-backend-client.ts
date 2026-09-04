import type {
  ConnectorImportGrantRequestV2,
  OutboundExecutionGrantRequestV2,
} from '@place/contracts/transfers'

export type ConnectorTransferBackendClientConfig = Readonly<{
  origin: string
  publicOrigin: string
  timeoutMilliseconds: number
  request?: (input: URL, init: RequestInit) => Promise<Response>
}>

function configurationError(): Error {
  return new Error('Connector transfer backend configuration is invalid')
}

function configuredOrigin(value: string, publicOnly = false): URL {
  let origin: URL
  try { origin = new URL(value) } catch { throw configurationError() }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']).has(origin.hostname)
  if (
    value !== origin.origin || origin.username !== '' || origin.password !== '' ||
    (publicOnly && origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) ||
    (!publicOnly && !['http:', 'https:'].includes(origin.protocol))
  ) throw configurationError()
  return origin
}

/** Fixed-route client. Callers cannot choose a Backend origin, path, or forwarded headers. */
export function createConnectorTransferBackendClient(config: ConnectorTransferBackendClientConfig) {
  const origin = configuredOrigin(config.origin)
  const publicOrigin = configuredOrigin(config.publicOrigin, true).origin
  if (
    !Number.isInteger(config.timeoutMilliseconds) || config.timeoutMilliseconds <= 0 ||
    config.timeoutMilliseconds > 60_000
  ) throw configurationError()
  const request = config.request ?? fetch

  function send(
    pathname: string,
    authorization: string,
    signal: AbortSignal,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<Response> {
    return request(new URL(pathname, origin), {
      method,
      headers: {
        accept: 'application/json', authorization, origin: publicOrigin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMilliseconds)]),
    })
  }

  const memberPost = (pathname: string, token: string, body: unknown, signal: AbortSignal) =>
    send(pathname, `Bearer ${token}`, signal, 'POST', body)
  return Object.freeze({
    publicOrigin,
    issueImportGrant: (
      token: string, body: ConnectorImportGrantRequestV2, signal: AbortSignal,
    ) => memberPost('/v2/transfers/connector-import-grants', token, body, signal),
    issueOutboundGrant: (
      token: string, body: OutboundExecutionGrantRequestV2, signal: AbortSignal,
    ) => memberPost('/v2/transfers/outbound-execution-grants', token, body, signal),
  })
}

export type ConnectorTransferBackendClient = ReturnType<
  typeof createConnectorTransferBackendClient
>
