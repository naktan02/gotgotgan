import {
  browserLibraryCommandRequestSchema,
  type BrowserLibraryCommandRequest,
} from '@place/contracts/http'
import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  libraryCollectionDetailResponseSchema,
  libraryCommandResultSchema,
  type CollectionLifecycleCommandRequestV2,
  type CollectionLifecycleCommandResultV2,
  type LibraryCollectionDetailResponse,
} from '@place/contracts/library'

export class CollectionManagementProblem extends Error {
  constructor(readonly status: number) {
    super('Collection management request failed')
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new CollectionManagementProblem(response.status || 503)
  }
  return response.json()
}

export function createCollectionManagementClient(fetcher: typeof fetch = fetch) {
  return {
    async detail(
      collectionId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<LibraryCollectionDetailResponse> {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(
        `/api/library/collections/${encodeURIComponent(collectionId)}?${parameters}`,
        { cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
      )
      const value = await json(response)
      if (!response.ok) throw new CollectionManagementProblem(response.status)
      return libraryCollectionDetailResponseSchema.parse(value)
    },

    async setVisibility(
      request: CollectionLifecycleCommandRequestV2,
      signal?: AbortSignal,
    ): Promise<CollectionLifecycleCommandResultV2> {
      const body = collectionLifecycleCommandRequestV2Schema.parse(request)
      const response = await fetcher('/api/library/collection-commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      const parsed = collectionLifecycleCommandResultV2Schema.safeParse(value)
      if (parsed.success) return parsed.data
      throw new CollectionManagementProblem(response.status || 503)
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
      if (!response.ok) throw new CollectionManagementProblem(response.status)
      return libraryCommandResultSchema.parse(value)
    },
  }
}

export const collectionManagementClient = createCollectionManagementClient()
