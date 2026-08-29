import {
  type PublishedCollectionMapQuery,
  type PublishedCollectionQuery,
  publishedCollectionMapSchema,
  publishedCollectionSchema,
  publishedWritingSchema,
} from '@place/contracts/http'

import { requestFixedBackend } from '../backend-http/fixed-backend'

export class PublicationNotFoundError extends Error {
  override readonly name = 'PublicationNotFoundError'
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
