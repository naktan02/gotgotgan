import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  personalLibraryMapRequestV2Schema,
  personalLibraryMapResponseV2Schema,
  libraryTagListResponseSchema,
  personalLibraryWorkspaceRequestV2Schema,
  personalLibraryWorkspaceResponseV2Schema,
  type PersonalLibraryMapRequestV2,
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
  if (parsed.collectionQuery !== undefined) parameters.set('collectionQuery', parsed.collectionQuery)
  if (parsed.placeQuery !== undefined) parameters.set('placeQuery', parsed.placeQuery)
  if (parsed.includeSelectedCollection) parameters.set('includeSelectedCollection', 'true')
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

    async tags(signal?: AbortSignal, cursor?: string) {
      const parameters = new URLSearchParams({ limit: '50' })
      if (cursor !== undefined) parameters.set('cursor', cursor)
      const response = await fetcher(`/api/library/tags?${parameters}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new CollectionLibraryProblem(response.status)
      return libraryTagListResponseSchema.parse(value)
    },

    async map(query: PersonalLibraryMapRequestV2, signal?: AbortSignal) {
      const parsed = personalLibraryMapRequestV2Schema.parse(query)
      const parameters = new URLSearchParams({
        rating: parsed.ratingFilter.kind,
        tagMatch: parsed.tagMatch,
        west: String(parsed.west),
        south: String(parsed.south),
        east: String(parsed.east),
        north: String(parsed.north),
        zoom: String(parsed.zoom),
      })
      if (parsed.favoriteScope.kind === 'collection') parameters.set('collectionId', parsed.favoriteScope.collectionId)
      for (const key of parsed.tagIds) parameters.append('tagIds', key)
      for (const key of parsed.areaKeys) parameters.append('areaKeys', key)
      for (const key of parsed.taxonomyKeys) parameters.append('taxonomyKeys', key)
      if (parsed.placeQuery !== undefined) parameters.set('placeQuery', parsed.placeQuery)
      const response = await fetcher(`/api/library/workspace/map?${parameters}`, {
        cache: 'no-store',
        ...(signal === undefined ? {} : { signal }),
      })
      const value = await json(response)
      if (!response.ok) throw new CollectionLibraryProblem(response.status)
      return personalLibraryMapResponseV2Schema.parse(value)
    },
  }
}

export const collectionLibraryHttp = createCollectionLibraryHttp()
