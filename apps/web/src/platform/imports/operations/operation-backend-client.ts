import type { TransferOperationCommandRequestV2 } from '@place/contracts/transfers'

export type OperationBackendClientConfig = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>
  fetcher?: (input: URL, init: RequestInit) => Promise<Response>
  timeoutMilliseconds?: number
}>

export function createOperationBackendClient(config: OperationBackendClientConfig = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000) {
    throw new Error('Operation backend configuration is invalid')
  }

  function send(
    pathname: string,
    accessToken: string,
    signal: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ) {
    const originValue = environment.PLACE_BACKEND_ORIGIN
    if (originValue === undefined) throw new Error('Operation backend is unavailable')
    const origin = new URL(originValue)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username !== '' || origin.password !== '' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
      throw new Error('Operation backend is unavailable')
    }
    return fetcher(new URL(pathname, origin), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]),
    })
  }

  return {
    list: (accessToken: string, query: string, signal: AbortSignal) =>
      send(`/v2/operations${query}`, accessToken, signal),
    summary: (accessToken: string, signal: AbortSignal) =>
      send('/v2/operations/summary', accessToken, signal),
    detail: (accessToken: string, operationId: string, signal: AbortSignal) =>
      send(`/v2/operations/${encodeURIComponent(operationId)}`, accessToken, signal),
    items: (accessToken: string, operationId: string, query: string, signal: AbortSignal) =>
      send(`/v2/operations/${encodeURIComponent(operationId)}/items${query}`, accessToken, signal),
    command: (accessToken: string, body: TransferOperationCommandRequestV2, signal: AbortSignal) =>
      send('/v2/operation-commands', accessToken, signal, 'POST', body),
  }
}

export type OperationBackendClient = ReturnType<typeof createOperationBackendClient>
