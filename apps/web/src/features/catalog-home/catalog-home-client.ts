import {
  catalogPlaceSearchRequestSchema,
  catalogPlaceSearchResponseSchema,
  type CatalogPlaceSearchResponse,
  type SearchBounds,
} from '@place/contracts/search'

export class CatalogHomeProblem extends Error {
  constructor(readonly status: number) {
    super('Catalog Home request failed')
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new CatalogHomeProblem(response.status)
  }
  return response.json()
}

export function createCatalogHomeClient(fetcher: typeof fetch = fetch) {
  return {
    async search(input: Readonly<{
      query: string
      excludedTokenIds?: readonly string[]
      bounds?: SearchBounds
      cursor?: string
      signal?: AbortSignal
    }>): Promise<CatalogPlaceSearchResponse> {
      const body = catalogPlaceSearchRequestSchema.parse({
        schemaVersion: 'catalog-place-search.v1',
        query: input.query,
        excludedTokenIds: input.excludedTokenIds ?? [],
        ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: 20,
      })
      const response = await fetcher('/api/search/catalog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      return catalogPlaceSearchResponseSchema.parse(await json(response))
    },
  }
}

export type CatalogHomeClient = ReturnType<typeof createCatalogHomeClient>
export const catalogHomeClient = createCatalogHomeClient()
