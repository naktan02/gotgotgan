import {
  type PublishedCollectionMapQuery,
  type PublishedCollectionQuery,
  publishedCollectionMapSchema,
  publishedCollectionSchema,
  publishedWritingSchema,
} from '@place/contracts/http'
import { publicPlaceDetailResponseSchema } from '@place/contracts/places'
import {
  type DiscoverableCollectionQueryV2,
  type PublicCollectionDirectoryQueryV2,
  discoverableCollectionResponseV2Schema,
  publicCollectionDirectoryResponseV2Schema,
} from '@place/contracts/library'

import { requestFixedBackend } from '../backend-http/fixed-backend'

export class PublicationNotFoundError extends Error {
  override readonly name = 'PublicationNotFoundError'
}

export class PublicPlaceNotFoundError extends Error {
  override readonly name = 'PublicPlaceNotFoundError'
}

export class PublicPlaceRetiredError extends Error {
  override readonly name = 'PublicPlaceRetiredError'
}

async function requestProjection(pathname: string, environment: Readonly<Record<string, string | undefined>>): Promise<unknown> {
  const response = await requestFixedBackend(pathname, {
    signal: AbortSignal.timeout(5_000),
  }, environment)
  if (response.status === 404) throw new PublicationNotFoundError('Publication not found')
  if (!response.ok || response.headers.get('content-type')?.includes('application/json') !== true) {
    throw new Error('Publication backend is unavailable')
  }
  return response.json()
}

export async function getPublicCollection(
  publicationId: string,
  query: PublishedCollectionQuery = { limit: 50 },
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parameters = new URLSearchParams({ limit: String(query.limit) })
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
  const parsed = publishedCollectionSchema.safeParse(
    await requestProjection(
      `/v1/public/collections/${encodeURIComponent(publicationId)}?${parameters}`,
      environment,
    ),
  )
  if (!parsed.success) throw new Error('Backend returned invalid collection')
  return parsed.data
}

export async function getPublicCollectionMap(
  publicationId: string,
  query: PublishedCollectionMapQuery,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parameters = new URLSearchParams({
    west: String(query.west),
    south: String(query.south),
    east: String(query.east),
    north: String(query.north),
    zoom: String(query.zoom),
  })
  const parsed = publishedCollectionMapSchema.safeParse(await requestProjection(
    `/v1/public/collections/${encodeURIComponent(publicationId)}/map?${parameters}`,
    environment,
  ))
  if (!parsed.success) throw new Error('Backend returned invalid collection map')
  return parsed.data
}

function publicDirectoryParameters(query: PublicCollectionDirectoryQueryV2): URLSearchParams {
  const parameters = new URLSearchParams({ sort: query.sort, limit: String(query.limit) })
  if (query.q !== undefined) parameters.set('q', query.q)
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
  for (const areaKey of query.areaKeys) parameters.append('areaKeys', areaKey)
  for (const taxonomyKey of query.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
  for (const topicKey of query.topicKeys) parameters.append('topicKeys', topicKey)
  return parameters
}

export async function getPublicCollectionDirectory(
  query: PublicCollectionDirectoryQueryV2,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = publicCollectionDirectoryResponseV2Schema.safeParse(await requestProjection(
    `/v1/public/collection-directory?${publicDirectoryParameters(query)}`,
    environment,
  ))
  if (!parsed.success) throw new Error('Backend returned invalid public Collection directory')
  return parsed.data
}

export async function getDiscoverableCollection(
  publicationId: string,
  query: DiscoverableCollectionQueryV2,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parameters = new URLSearchParams({ limit: String(query.limit) })
  if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
  const parsed = discoverableCollectionResponseV2Schema.safeParse(await requestProjection(
    `/v1/public/discoverable-collections/${encodeURIComponent(publicationId)}?${parameters}`,
    environment,
  ))
  if (!parsed.success) throw new Error('Backend returned invalid discoverable Collection')
  return parsed.data
}

export async function getPublicWriting(
  publicationId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = publishedWritingSchema.safeParse(
    await requestProjection(`/v1/public/writing/${encodeURIComponent(publicationId)}`, environment),
  )
  if (!parsed.success) throw new Error('Backend returned invalid writing')
  return parsed.data
}

export async function getPublicPlaceDetail(
  placeId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const response = await requestFixedBackend(`/v1/places/${encodeURIComponent(placeId)}`, {
    signal: AbortSignal.timeout(5_000),
  }, environment)
  if (response.status === 404) throw new PublicPlaceNotFoundError('Place not found')
  if (response.status === 410) throw new PublicPlaceRetiredError('Place retired')
  if (!response.ok || response.headers.get('content-type')?.includes('application/json') !== true) {
    throw new Error('Public Place detail backend is unavailable')
  }
  const parsed = publicPlaceDetailResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error('Backend returned invalid public Place detail')
  return parsed.data
}
