import type { WritingCommandRequest } from '@place/contracts/http'
import type { WritingListQuery } from '@place/contracts/writing'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'

export type WritingBackendClientConfig = Readonly<{
  environment?: BackendEnvironment
  fetcher?: BackendFetcher
  timeoutMilliseconds?: number
}>

export function createWritingBackendClient(config: WritingBackendClientConfig = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000) {
    throw new Error('Writing backend configuration is invalid')
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
    list(accessToken: string, query: WritingListQuery, signal: AbortSignal) {
      const parameters = new URLSearchParams({ kind: query.kind, limit: String(query.limit) })
      if (query.placeId !== undefined) parameters.set('placeId', query.placeId)
      if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
      return send(`/v1/writing?${parameters}`, accessToken, signal)
    },
    detail(accessToken: string, documentId: string, signal: AbortSignal) {
      return send(`/v1/writing/${documentId}`, accessToken, signal)
    },
    command(accessToken: string, body: WritingCommandRequest, signal: AbortSignal) {
      return send('/v1/writing/commands', accessToken, signal, 'POST', body)
    },
  }
}

export type WritingBackendClient = ReturnType<typeof createWritingBackendClient>
