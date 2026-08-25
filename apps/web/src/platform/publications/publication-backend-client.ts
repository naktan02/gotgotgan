import {
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
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = publishedCollectionSchema.safeParse(
    await requestProjection(`/v1/public/collections/${encodeURIComponent(publicationId)}`, environment),
  )
  if (!parsed.success) throw new Error('Backend returned invalid collection')
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
