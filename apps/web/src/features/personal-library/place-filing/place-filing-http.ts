import {
  placeFilingCommandRequestV2Schema,
  placeFilingCommandResultV2Schema,
  placeFilingResponseV2Schema,
  type PlaceFilingCommandRequestV2,
  type PlaceFilingCommandResultV2,
  type PlaceFilingResponseV2,
} from '@place/contracts/library'

export class PlaceFilingProblem extends Error {
  constructor(readonly status: number) {
    super('Place filing request failed')
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new PlaceFilingProblem(response.status || 503)
  }
  return response.json()
}

export function createPlaceFilingHttp(fetcher: typeof fetch = fetch) {
  return {
    async read(
      placeId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<PlaceFilingResponseV2> {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(
        `/api/library/places/${placeId}/filing?${parameters}`,
        { cache: 'no-store', ...(signal === undefined ? {} : { signal }) },
      )
      const value = await json(response)
      if (!response.ok) throw new PlaceFilingProblem(response.status)
      return placeFilingResponseV2Schema.parse(value)
    },

    async command(
      request: PlaceFilingCommandRequestV2,
      signal?: AbortSignal,
    ): Promise<PlaceFilingCommandResultV2> {
      const body = placeFilingCommandRequestV2Schema.parse(request)
      const response = await fetcher('/api/library/filing-commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      const parsed = placeFilingCommandResultV2Schema.safeParse(value)
      if (parsed.success) return parsed.data
      throw new PlaceFilingProblem(response.status || 503)
    },
  }
}

export const placeFilingHttp = createPlaceFilingHttp()
