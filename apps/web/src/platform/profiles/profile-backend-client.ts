import type { PublicProfileQuery, SetPublicProfileRequest } from '@place/contracts/profiles'
import { publicProfileProjectionSchema } from '@place/contracts/profiles'

import {
  requestFixedBackend,
  type BackendEnvironment,
  type BackendFetcher,
} from '../backend-http/fixed-backend'

export class PublicProfileNotFoundError extends Error {
  override readonly name = 'PublicProfileNotFoundError'
}

type Config = Readonly<{
  environment?: BackendEnvironment
  fetcher?: BackendFetcher
  timeoutMilliseconds?: number
}>

export function createProfileBackendClient(config: Config = {}) {
  const environment = config.environment ?? process.env
  const fetcher = config.fetcher ?? fetch
  const timeoutMilliseconds = config.timeoutMilliseconds ?? 5_000

  function authenticated(
    pathname: string,
    accessToken: string,
    signal: AbortSignal,
    method: 'GET' | 'PUT' = 'GET',
    body?: unknown,
  ) {
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
    current(accessToken: string, signal: AbortSignal) {
      return authenticated('/v1/profiles/current', accessToken, signal)
    },
    set(accessToken: string, body: SetPublicProfileRequest, signal: AbortSignal) {
      return authenticated('/v1/profiles/current', accessToken, signal, 'PUT', body)
    },
    async published(handle: string, query: PublicProfileQuery, signal?: AbortSignal) {
      const parameters = new URLSearchParams({ limit: String(query.limit) })
      if (query.cursor !== undefined) parameters.set('cursor', query.cursor)
      const response = await requestFixedBackend(
        `/v1/public/profiles/${encodeURIComponent(handle)}?${parameters}`,
        { signal: signal ?? AbortSignal.timeout(timeoutMilliseconds) },
        environment,
        fetcher,
      )
      if (response.status === 404) throw new PublicProfileNotFoundError('Public Profile not found')
      if (!response.ok || response.headers.get('content-type')?.includes('application/json') !== true) {
        throw new Error('Public Profile backend is unavailable')
      }
      const parsed = publicProfileProjectionSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('Backend returned invalid Public Profile')
      return parsed.data
    },
  }
}

const profileBackendClient = createProfileBackendClient()

export function getPublicProfile(
  handle: string,
  query: PublicProfileQuery = { limit: 20 },
) {
  return profileBackendClient.published(handle, query)
}

export type ProfileBackendClient = ReturnType<typeof createProfileBackendClient>
