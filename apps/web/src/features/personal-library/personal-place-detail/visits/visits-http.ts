import type { BrowserVisitRecordRequest } from '@place/contracts/http'
import {
  visitHistoryResponseSchema,
  visitRecordResultSchema,
  type VisitHistoryResponse,
} from '@place/contracts/visits'

export class BrowserVisitProblem extends Error {
  constructor(readonly status: number) {
    super('Personal Visit request failed')
  }
}

async function payload(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new BrowserVisitProblem(response.status)
  }
  return response.json()
}

export function createPersonalLibraryVisitsHttp(fetcher: typeof fetch = fetch) {
  return {
    async history(
      placeId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<VisitHistoryResponse> {
      const parameters = new URLSearchParams({ limit: '20' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(
        `/api/places/${encodeURIComponent(placeId)}/visits?${parameters}`,
        {
          cache: 'no-store',
          ...(signal === undefined ? {} : { signal }),
        },
      )
      return visitHistoryResponseSchema.parse(await payload(response))
    },
    async record(request: BrowserVisitRecordRequest) {
      const response = await fetcher('/api/visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      return visitRecordResultSchema.parse(await payload(response))
    },
  }
}

export const personalLibraryVisitsHttp = createPersonalLibraryVisitsHttp()
