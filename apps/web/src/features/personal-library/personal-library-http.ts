import {
  libraryCommandRequestSchema,
  type LibraryCommandRequest,
} from '@place/contracts/http'
import {
  libraryCommandResultSchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionListResponseSchema,
  libraryPlaceFacetsResponseSchema,
  libraryPlaceListResponseSchema,
  libraryPlaceOrganizationResponseSchema,
  libraryTagListResponseSchema,
  type LibraryCollectionListResponse,
  type LibraryPlaceFacetsResponse,
  type LibraryPlaceState,
  type LibraryPlaceOrganizationResponse,
  type LibraryTagListResponse,
  type LibraryTagMatch,
} from '@place/contracts/library'
import {
  placeDetailResponseSchema,
  type PlaceSummary,
} from '@place/contracts/places'

export type PersonalLibraryRow = Readonly<{
  placeId: string
  place: PlaceSummary | null
  saved?: boolean
  wanted?: boolean
  personalRating?: number | null
  updatedAt?: string
  position?: number
}>

export type PersonalLibraryPage = Readonly<{
  rows: readonly PersonalLibraryRow[]
  nextCursor?: string
  collectionName?: string
}>

export class BrowserLibraryProblem extends Error {
  constructor(readonly status: number) {
    super('Personal Library request failed')
  }
}

async function payload(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new BrowserLibraryProblem(response.status)
  }
  return response.json()
}

function pathWithQuery(
  path: string,
  values: Readonly<Record<string, string | readonly string[] | undefined>>,
) {
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) parameters.append(key, item)
    } else {
      parameters.set(key, value as string)
    }
  }
  return `${path}?${parameters}`
}

export function createPersonalLibraryHttp(fetcher: typeof fetch = fetch) {
  const read = (path: string, signal?: AbortSignal) => fetcher(path, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }).then(payload)

  return {
    async facets(signal?: AbortSignal): Promise<LibraryPlaceFacetsResponse> {
      return libraryPlaceFacetsResponseSchema.parse(await read(
        '/api/library/place-facets',
        signal,
      ))
    },
    async tags(cursor?: string, signal?: AbortSignal): Promise<LibraryTagListResponse> {
      return libraryTagListResponseSchema.parse(await read(
        pathWithQuery('/api/library/tags', { limit: '50', cursor }),
        signal,
      ))
    },
    async collections(
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<LibraryCollectionListResponse> {
      return libraryCollectionListResponseSchema.parse(await read(
        pathWithQuery('/api/library/collections', { limit: '50', cursor }),
        signal,
      ))
    },
    async organization(
      placeId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<LibraryPlaceOrganizationResponse> {
      return libraryPlaceOrganizationResponseSchema.parse(await read(pathWithQuery(
        `/api/library/places/${placeId}/organization`,
        { limit: '50', cursor },
      ), signal))
    },
    async command(request: LibraryCommandRequest, signal?: AbortSignal) {
      const body = libraryCommandRequestSchema.parse(request)
      const response = await fetcher('/api/library/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      })
      return libraryCommandResultSchema.parse(await payload(response))
    },
    async places(
      state: LibraryPlaceState,
      tagIds: readonly string[],
      tagMatch: LibraryTagMatch,
      areaKeys: readonly string[],
      taxonomyKeys: readonly string[],
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<PersonalLibraryPage> {
      const page = libraryPlaceListResponseSchema.parse(await read(pathWithQuery(
        '/api/library/places',
        {
          state,
          tagMatch,
          tagIds: [...tagIds].sort(),
          areaKeys: [...areaKeys].sort(),
          taxonomyKeys: [...taxonomyKeys].sort(),
          limit: '20', cursor,
        },
      ), signal))
      return { rows: page.items, nextCursor: page.nextCursor }
    },
    async collection(
      collectionId: string,
      cursor?: string,
      signal?: AbortSignal,
    ): Promise<PersonalLibraryPage> {
      const page = libraryCollectionDetailResponseSchema.parse(await read(pathWithQuery(
        `/api/library/collections/${collectionId}`,
        { limit: '20', cursor },
      ), signal))
      return {
        rows: page.places,
        nextCursor: page.nextCursor,
        collectionName: page.collection.name,
      }
    },
    async place(placeId: string, signal?: AbortSignal) {
      return placeDetailResponseSchema.parse(await read(`/api/places/${placeId}`, signal))
    },
  }
}

export type PersonalLibraryHttp = ReturnType<typeof createPersonalLibraryHttp>

export const personalLibraryHttp = createPersonalLibraryHttp()
