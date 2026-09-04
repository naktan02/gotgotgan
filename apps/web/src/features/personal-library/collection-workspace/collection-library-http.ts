import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  libraryMapQuerySchema,
  libraryMapResponseSchema,
  libraryTagListResponseSchema,
  personalLibraryWorkspaceRequestV2Schema,
  personalLibraryWorkspaceResponseV2Schema,
  type LibraryMapQuery,
  type CollectionLifecycleCommandRequestV2,
  type CollectionLifecycleCommandResultV2,
  type PersonalLibraryWorkspaceRequestV2,
  type PersonalLibraryWorkspaceResponseV2,
} from '@place/contracts/library'

export class CollectionLibraryProblem extends Error {
  constructor(readonly status: number) {
    super('Collection-first Personal Library request failed')
  }
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new CollectionLibraryProblem(response.status || 503)
  }
  return response.json()
}

function workspacePath(query: PersonalLibraryWorkspaceRequestV2) {
  const parsed = personalLibraryWorkspaceRequestV2Schema.parse(query)
  const parameters = new URLSearchParams({
    rating: parsed.ratingFilter.kind,
    tagMatch: parsed.tagMatch,
    limit: String(parsed.limit),
  })
  if (parsed.favoriteScope.kind === 'collection') {
    parameters.set('collectionId', parsed.favoriteScope.collectionId)
  }
  for (const tagId of parsed.tagIds) parameters.append('tagIds', tagId)
  for (const areaKey of parsed.areaKeys) parameters.append('areaKeys', areaKey)
  for (const taxonomyKey of parsed.taxonomyKeys) parameters.append('taxonomyKeys', taxonomyKey)
  if (parsed.collectionCursor !== undefined) {
    parameters.set('collectionCursor', parsed.collectionCursor)
  }
  if (parsed.placeCursor !== undefined) parameters.set('placeCursor', parsed.placeCursor)
  return `/api/library/workspace?${parameters}`
}

export function createCollectionLibraryHttp(fetcher: typeof fetch = fetch) {
  return {
    async workspace(
      query: PersonalLibraryWorkspaceRequestV2,
      signal?: AbortSignal,
    ): Promise<PersonalLibraryWorkspaceResponseV2> {
      const response = await fetcher(workspacePath(query), {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new CollectionLibraryProblem(response.status)
      return personalLibraryWorkspaceResponseV2Schema.parse(value)
    },

    async collectionCommand(
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
      throw new CollectionLibraryProblem(response.status || 503)
    },

    async tags(signal?: AbortSignal) {
      const response = await fetcher('/api/library/tags?limit=50', {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new CollectionLibraryProblem(response.status)
      return libraryTagListResponseSchema.parse(value)
    },

    async map(query: LibraryMapQuery, signal?: AbortSignal) {
      const parsed = libraryMapQuerySchema.parse(query)
      const parameters = new URLSearchParams({
        scope: 'collection',
        collectionId: parsed.scope === 'collection' ? parsed.collectionId : '',
        west: String(parsed.west),
        south: String(parsed.south),
        east: String(parsed.east),
        north: String(parsed.north),
        zoom: String(parsed.zoom),
      })
      const response = await fetcher(`/api/library/map?${parameters}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new CollectionLibraryProblem(response.status)
      return libraryMapResponseSchema.parse(value)
    },
  }
}

export const collectionLibraryHttp = createCollectionLibraryHttp()
