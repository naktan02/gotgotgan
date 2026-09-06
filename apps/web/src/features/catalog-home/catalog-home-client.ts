import {
  catalogPlaceMapRequestV2Schema as catalogPlaceMapRequestSchema,
  catalogPlaceMapResponseV2Schema as catalogPlaceMapResponseSchema,
  catalogPlaceSearchRequestV2Schema as catalogPlaceSearchRequestSchema,
  catalogPlaceSearchResponseV2Schema as catalogPlaceSearchResponseSchema,
  catalogExplorationResponseSchema,
  type CatalogSearchIntent,
  type CatalogPlaceMapResponseV2,
  type CatalogPlaceSearchResponseV2,
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
    async explore(query: string, signal?: AbortSignal, near?: Readonly<{ latitude: number; longitude: number }>) {
      const response = await fetcher('/api/search/catalog/explore', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 'catalog-exploration.v1', query, ...(near === undefined ? {} : { near }) }), cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      return catalogExplorationResponseSchema.parse(await json(response))
    },
    async map(input: Readonly<{
      taxonomyKey?: string
      intent?: CatalogSearchIntent
      query: string
      excludedTokenIds?: readonly string[]
      viewport: SearchBounds
      zoom: number
      signal?: AbortSignal
    }>): Promise<CatalogPlaceMapResponseV2> {
      const body = catalogPlaceMapRequestSchema.parse({
        schemaVersion: 'catalog-place-map.v2', intent: input.intent ?? 'auto',
        ...(input.taxonomyKey === undefined ? {} : { taxonomyKey: input.taxonomyKey }),
        query: input.query,
        excludedTokenIds: input.excludedTokenIds ?? [],
        viewport: input.viewport,
        zoom: input.zoom,
        maxFeatures: 384,
      })
      const response = await fetcher('/api/v2/search/catalog/map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      return catalogPlaceMapResponseSchema.parse(await json(response))
    },

    async search(input: Readonly<{
      taxonomyKey?: string
      near?: Readonly<{ latitude: number; longitude: number }>
      intent?: CatalogSearchIntent
      query: string
      excludedTokenIds?: readonly string[]
      bounds?: SearchBounds
      cursor?: string
      signal?: AbortSignal
    }>): Promise<CatalogPlaceSearchResponseV2> {
      const body = catalogPlaceSearchRequestSchema.parse({
        schemaVersion: 'catalog-place-search.v2', intent: input.intent ?? 'auto',
        ...(input.taxonomyKey === undefined ? {} : { taxonomyKey: input.taxonomyKey }),
        ...(input.near === undefined ? {} : { near: input.near }),
        query: input.query,
        excludedTokenIds: input.excludedTokenIds ?? [],
        ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: 20,
      })
      const response = await fetcher('/api/v2/search/catalog', {
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
