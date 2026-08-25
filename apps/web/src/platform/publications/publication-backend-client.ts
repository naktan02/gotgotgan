type PublicCollection = Readonly<{
  publicationId: string
  visibility: 'unlisted' | 'public'
  name: string
  description: string | null
  places: readonly Readonly<{ placeId: string; position: number }>[]
  updatedAt: string
}>

type PublicWriting = Readonly<{
  kind: 'note' | 'entry'
  publicationId: string
  visibility: 'unlisted' | 'public'
  title?: string
  body: string
  placeIds: readonly string[]
  updatedAt: string
}>

export class PublicationNotFoundError extends Error {
  override readonly name = 'PublicationNotFoundError'
}

function backendOrigin(environment: Readonly<Record<string, string | undefined>>): URL {
  const value = environment.PLACE_BACKEND_ORIGIN
  if (value === undefined) throw new Error('Publication backend is unavailable')
  const origin = new URL(value)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username !== '' || origin.password !== '' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
    throw new Error('Publication backend is unavailable')
  }
  return origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseCollection(value: unknown): PublicCollection {
  if (!isRecord(value) || typeof value.publicationId !== 'string' ||
    !['unlisted', 'public'].includes(String(value.visibility)) || typeof value.name !== 'string' ||
    !(value.description === null || typeof value.description === 'string') ||
    !Array.isArray(value.places) || !value.places.every((place) => isRecord(place) && typeof place.placeId === 'string' && Number.isInteger(place.position)) ||
    typeof value.updatedAt !== 'string' || Object.keys(value).some((key) => !['publicationId', 'visibility', 'name', 'description', 'places', 'updatedAt'].includes(key))) {
    throw new Error('Publication backend returned an invalid collection')
  }
  return value as PublicCollection
}

function parseWriting(value: unknown): PublicWriting {
  if (!isRecord(value) || !['note', 'entry'].includes(String(value.kind)) ||
    typeof value.publicationId !== 'string' || !['unlisted', 'public'].includes(String(value.visibility)) ||
    typeof value.body !== 'string' || !stringArray(value.placeIds) || typeof value.updatedAt !== 'string' ||
    (value.kind === 'entry' && typeof value.title !== 'string') ||
    Object.keys(value).some((key) => !['kind', 'publicationId', 'visibility', 'title', 'body', 'placeIds', 'updatedAt'].includes(key))) {
    throw new Error('Publication backend returned invalid writing')
  }
  return value as PublicWriting
}

async function requestProjection(pathname: string, environment: Readonly<Record<string, string | undefined>>): Promise<unknown> {
  const response = await fetch(new URL(pathname, backendOrigin(environment)), {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  })
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
  return parseCollection(await requestProjection(`/v1/public/collections/${encodeURIComponent(publicationId)}`, environment))
}

export async function getPublicWriting(
  publicationId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return parseWriting(await requestProjection(`/v1/public/writing/${encodeURIComponent(publicationId)}`, environment))
}
