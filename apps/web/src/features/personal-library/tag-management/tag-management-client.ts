import {
  browserLibraryCommandRequestSchema,
  type BrowserLibraryCommandRequest,
} from '@place/contracts/http'
import {
  libraryCommandResultSchema,
  libraryTagListResponseSchema,
  type LibraryTagListResponse,
} from '@place/contracts/library'

export class TagManagementProblem extends Error {
  constructor(readonly status: number) {
    super('Tag management request failed')
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new TagManagementProblem(response.status || 503)
  }
  return response.json()
}

export function createTagManagementClient(fetcher: typeof fetch = fetch) {
  return {
    async list(cursor?: string, signal?: AbortSignal): Promise<LibraryTagListResponse> {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(`/api/library/tags?${parameters}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new TagManagementProblem(response.status)
      return libraryTagListResponseSchema.parse(value)
    },

    async command(request: BrowserLibraryCommandRequest, signal?: AbortSignal) {
      const body = browserLibraryCommandRequestSchema.parse(request)
      const response = await fetcher('/api/library/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new TagManagementProblem(response.status)
      return libraryCommandResultSchema.parse(value)
    },
  }
}

export const tagManagementClient = createTagManagementClient()
