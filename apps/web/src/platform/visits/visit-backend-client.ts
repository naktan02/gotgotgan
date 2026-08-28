import type { BrowserVisitRecordRequest } from '@place/contracts/http'
import type { VisitHistoryQuery } from '@place/contracts/visits'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'

export type VisitBackendClientConfig = Readonly<{
  environment?: BackendEnvironment
  fetcher?: BackendFetcher
  timeoutMilliseconds?: number
}>

export function createVisitBackendClient(config: VisitBackendClientConfig = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000) {
    throw new Error('Visit backend configuration is invalid')
  }

  function send(
    pathname: string,
    accessToken: string,
    signal: AbortSignal,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
  ): Promise<Response> {
    return requestFixedBackend(pathname, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]),
    }, environment, fetcher)
  }

  return {
    history(
      accessToken: string,
      placeId: string,
      query: VisitHistoryQuery,
      signal: AbortSignal,
    ) {
      const parameters = new URLSearchParams({ limit: String(query.limit) })
      if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
      return send(`/v1/places/${placeId}/visits?${parameters}`, accessToken, signal)
    },
    record(accessToken: string, body: BrowserVisitRecordRequest, signal: AbortSignal) {
      return send('/v1/visits', accessToken, signal, 'POST', body)
    },
  }
}

export type VisitBackendClient = ReturnType<typeof createVisitBackendClient>
