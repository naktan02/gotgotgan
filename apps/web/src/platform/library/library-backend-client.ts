import type {
  LibraryCollectionDetailQuery,
  LibraryCollectionListQuery,
  LibraryPlaceListQuery,
  LibraryTagListQuery,
} from '@place/contracts/library'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'

export type LibraryBackendClientConfig = Readonly<{
  environment?: BackendEnvironment
  fetcher?: BackendFetcher
  timeoutMilliseconds?: number
}>

function queryString(query: Readonly<{ cursor?: string; limit: number }>): URLSearchParams {
  const parameters = new URLSearchParams({ limit: String(query.limit) })
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
  return parameters
}

export function createLibraryBackendClient(config: LibraryBackendClientConfig = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 || timeoutMilliseconds > 60_000) {
    throw new Error('Library backend configuration is invalid')
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
    places(accessToken: string, query: LibraryPlaceListQuery, signal: AbortSignal) {
      const parameters = queryString(query)
      parameters.set('state', query.state)
      parameters.set('tagMatch', query.tagMatch)
      for (const tagId of query.tagIds) parameters.append('tagIds', tagId)
      return send(`/v1/library/places?${parameters}`, accessToken, signal)
    },
    collections(accessToken: string, query: LibraryCollectionListQuery, signal: AbortSignal) {
      return send(`/v1/library/collections?${queryString(query)}`, accessToken, signal)
    },
    collection(
      accessToken: string,
      collectionId: string,
      query: LibraryCollectionDetailQuery,
      signal: AbortSignal,
    ) {
      return send(
        `/v1/library/collections/${collectionId}?${queryString(query)}`,
        accessToken,
        signal,
      )
    },
    tags(accessToken: string, query: LibraryTagListQuery, signal: AbortSignal) {
      return send(`/v1/library/tags?${queryString(query)}`, accessToken, signal)
    },
    command(accessToken: string, body: unknown, signal: AbortSignal) {
      return send('/v1/library/commands', accessToken, signal, 'POST', body)
    },
    place(accessToken: string, placeId: string, signal: AbortSignal) {
      return send(`/v1/places/${placeId}`, accessToken, signal)
    },
  }
}

export type LibraryBackendClient = ReturnType<typeof createLibraryBackendClient>
