import {
  problemSchema,
  type BrowserPrivateNoteCommandRequest,
} from '@place/contracts/http'
import {
  writingCommandResultSchema,
  writingDetailResponseSchema,
  writingListResponseSchema,
  type WritingDetailResponse,
  type WritingListResponse,
} from '@place/contracts/writing'

export class BrowserWritingProblem extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super('Personal Writing request failed')
  }
}

async function payload(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new BrowserWritingProblem(response.status)
  }
  const value: unknown = await response.json()
  if (!response.ok) {
    throw new BrowserWritingProblem(response.status, problemSchema.safeParse(value).data?.code)
  }
  return value
}

export function createPersonalLibraryNotesHttp(fetcher: typeof fetch = fetch) {
  return {
    async list(
      placeId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<WritingListResponse> {
      const parameters = new URLSearchParams({ kind: 'note', placeId, limit: '10' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(`/api/writing?${parameters}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      return writingListResponseSchema.parse(await payload(response))
    },
    async detail(documentId: string, signal?: AbortSignal): Promise<WritingDetailResponse> {
      const response = await fetcher(`/api/writing/${encodeURIComponent(documentId)}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      return writingDetailResponseSchema.parse(await payload(response))
    },
    async command(request: BrowserPrivateNoteCommandRequest) {
      const response = await fetcher('/api/writing/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      return writingCommandResultSchema.parse(await payload(response))
    },
  }
}

export const personalLibraryNotesHttp = createPersonalLibraryNotesHttp()
