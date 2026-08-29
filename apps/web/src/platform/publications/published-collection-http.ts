import {
  type PublishedCollectionMapQuery,
  publishedCollectionMapSchema,
  publishedCollectionSchema,
} from '@place/contracts/http'

export class PublishedCollectionHttpProblem extends Error {
  override readonly name = 'PublishedCollectionHttpProblem'

  constructor(readonly status: number) {
    super(`Published Collection request failed with ${status}`)
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new PublishedCollectionHttpProblem(response.status)
  if (response.headers.get('content-type')?.includes('application/json') !== true) {
    throw new PublishedCollectionHttpProblem(503)
  }
  return response.json()
}

export const publishedCollectionHttp = {
  async page(publicationId: string, cursor?: string, signal?: AbortSignal) {
    const parameters = new URLSearchParams({ limit: '50' })
    if (cursor !== undefined) parameters.set('cursor', cursor)
    const parsed = publishedCollectionSchema.safeParse(await readJson(await fetch(
      `/api/public/collections/${encodeURIComponent(publicationId)}?${parameters}`,
      { cache: 'no-store', signal },
    )))
    if (!parsed.success) throw new PublishedCollectionHttpProblem(503)
    return parsed.data
  },

  async map(publicationId: string, query: PublishedCollectionMapQuery, signal?: AbortSignal) {
    const parameters = new URLSearchParams({
      west: String(query.west),
      south: String(query.south),
      east: String(query.east),
      north: String(query.north),
      zoom: String(query.zoom),
    })
    const parsed = publishedCollectionMapSchema.safeParse(await readJson(await fetch(
      `/api/public/collections/${encodeURIComponent(publicationId)}/map?${parameters}`,
      { cache: 'no-store', signal },
    )))
    if (!parsed.success) throw new PublishedCollectionHttpProblem(503)
    return parsed.data
  },
}
