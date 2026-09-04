import {
  browserLibraryCommandRequestSchema,
  type BrowserLibraryCommandRequest,
} from '@place/contracts/http'
import {
  libraryCommandResultSchema,
  libraryPlaceOrganizationResponseSchema,
  type LibraryPlaceOrganizationResponse,
} from '@place/contracts/library'
import { placeDetailResponseSchema } from '@place/contracts/places'

export class BrowserLibraryProblem extends Error {
  constructor(readonly status: number) {
    super('Personal place request failed')
  }
}

async function payload(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new BrowserLibraryProblem(response.status)
  }
  return response.json()
}

export function createPersonalPlaceClient(fetcher: typeof fetch = fetch) {
  return {
    async organization(
      placeId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<LibraryPlaceOrganizationResponse> {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(
        `/api/library/places/${encodeURIComponent(placeId)}/organization?${parameters}`,
        { cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
      )
      return libraryPlaceOrganizationResponseSchema.parse(await payload(response))
    },

    async command(request: BrowserLibraryCommandRequest, signal?: AbortSignal) {
      const body = browserLibraryCommandRequestSchema.parse(request)
      const response = await fetcher('/api/library/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
      return libraryCommandResultSchema.parse(await payload(response))
    },

    async place(placeId: string, signal?: AbortSignal) {
      const response = await fetcher(`/api/places/${encodeURIComponent(placeId)}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      return placeDetailResponseSchema.parse(await payload(response))
    },
  }
}

export const personalPlaceClient = createPersonalPlaceClient()
