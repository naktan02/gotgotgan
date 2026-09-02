import type {
  CollectionLifecycleCommandRequestV2,
  LibraryCollectionDetailQuery,
  LibraryCollectionListQuery,
  LibraryMapQuery,
  LibraryPlaceListQuery,
  LibraryPlaceOrganizationQuery,
  LibraryTagListQuery,
  PersonalLibraryWorkspaceRequestV2,
  PlaceFilingCommandRequestV2,
  PlaceFilingRequestV2,
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

function mapQueryString(query: LibraryMapQuery): URLSearchParams {
  const parameters = new URLSearchParams({
    scope: query.scope,
    west: String(query.west),
    south: String(query.south),
    east: String(query.east),
    north: String(query.north),
    zoom: String(query.zoom),
  })
  if (query.scope === 'collection') {
    parameters.set('collectionId', query.collectionId)
    return parameters
  }
  parameters.set('state', query.state)
  parameters.set('tagMatch', query.tagMatch)
  for (const tagId of query.tagIds) parameters.append('tagIds', tagId)
  for (const areaKey of query.areaKeys) parameters.append('areaKeys', areaKey)
  for (const taxonomyKey of query.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
  return parameters
}

function workspaceQueryString(query: PersonalLibraryWorkspaceRequestV2): URLSearchParams {
  const parameters = new URLSearchParams({
    rating: query.ratingFilter.kind,
    tagMatch: query.tagMatch,
    limit: String(query.limit),
  })
  if (query.favoriteScope.kind === 'collection') {
    parameters.set('collectionId', query.favoriteScope.collectionId)
  }
  for (const tagId of query.tagIds) parameters.append('tagIds', tagId)
  for (const areaKey of query.areaKeys) parameters.append('areaKeys', areaKey)
  for (const taxonomyKey of query.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
  if (query.collectionCursor !== undefined) {
    parameters.set('collectionCursor', query.collectionCursor)
  }
  if (query.placeCursor !== undefined) parameters.set('placeCursor', query.placeCursor)
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
    collectionCommand(
      accessToken: string,
      body: CollectionLifecycleCommandRequestV2,
      signal: AbortSignal,
    ) {
      return send('/v1/library/collection-commands', accessToken, signal, 'POST', body)
    },
    workspace(
      accessToken: string,
      query: PersonalLibraryWorkspaceRequestV2,
      signal: AbortSignal,
    ) {
      return send(`/v1/library/workspace?${workspaceQueryString(query)}`, accessToken, signal)
    },
    filing(
      accessToken: string,
      placeId: string,
      query: PlaceFilingRequestV2,
      signal: AbortSignal,
    ) {
      return send(
        `/v1/library/places/${placeId}/filing?${queryString(query)}`,
        accessToken,
        signal,
      )
    },
    filingCommand(
      accessToken: string,
      body: PlaceFilingCommandRequestV2,
      signal: AbortSignal,
    ) {
      return send('/v1/library/filing-commands', accessToken, signal, 'POST', body)
    },
    map(accessToken: string, query: LibraryMapQuery, signal: AbortSignal) {
      return send(`/v1/library/map?${mapQueryString(query)}`, accessToken, signal)
    },
    places(accessToken: string, query: LibraryPlaceListQuery, signal: AbortSignal) {
      const parameters = queryString(query)
      parameters.set('state', query.state)
      parameters.set('tagMatch', query.tagMatch)
      for (const tagId of query.tagIds) parameters.append('tagIds', tagId)
      for (const areaKey of query.areaKeys) parameters.append('areaKeys', areaKey)
      for (const taxonomyKey of query.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
      return send(`/v1/library/places?${parameters}`, accessToken, signal)
    },
    facets(accessToken: string, signal: AbortSignal) {
      return send('/v1/library/place-facets', accessToken, signal)
    },
    organization(
      accessToken: string,
      placeId: string,
      query: LibraryPlaceOrganizationQuery,
      signal: AbortSignal,
    ) {
      return send(
        `/v1/library/places/${placeId}/organization?${queryString(query)}`,
        accessToken,
        signal,
      )
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
