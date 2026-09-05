import { randomUUID } from 'node:crypto'

import {
  browserLibraryCommandRequestSchema,
  placeIdentifierParamsSchema,
  problemSchema,
} from '@place/contracts/http'
import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  libraryCollectionDetailQuerySchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionIdentifierParamsSchema,
  libraryCollectionListQuerySchema,
  libraryCollectionListResponseSchema,
  libraryMapQuerySchema,
  libraryMapResponseSchema,
  libraryCommandResultSchema,
  libraryPlaceListQuerySchema,
  libraryPlaceListResponseSchema,
  libraryPlaceFacetsResponseSchema,
  libraryPlaceFacetsQuerySchema,
  libraryPlaceIdentifierParamsSchema,
  libraryPlaceOrganizationQuerySchema,
  libraryPlaceOrganizationResponseSchema,
  libraryTagListQuerySchema,
  libraryTagListResponseSchema,
  personalLibraryWorkspaceRequestV2Schema,
  personalLibraryWorkspaceResponseV2Schema,
  personalLibraryMapHttpQueryV2Schema,
  personalLibraryMapResponseV2Schema,
  placeFilingCommandRequestV2Schema,
  placeFilingCommandResultV2Schema,
  placeFilingRequestV2Schema,
  placeFilingResponseV2Schema,
  publishedCollectionCopyCommandRequestV2Schema,
  publishedCollectionCopyCommandResultV2Schema,
} from '@place/contracts/library'
import { placeDetailResponseSchema } from '@place/contracts/places'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import {
  createLibraryBackendClient,
  type LibraryBackendClient,
} from './library-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: LibraryBackendClient
  createCorrelationRef: () => string
}>
type Schema<T> = Readonly<{
  safeParse: (value: unknown) =>
    | Readonly<{ success: true; data: T }>
    | Readonly<{ success: false; data?: undefined }>
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function problem(
  status: number,
  code: string,
  title: string,
  correlationRef: string,
  retryable = status === 409 || status === 503,
): Response {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title,
    status,
    code,
    retryable,
    correlationRef,
  }, {
    status,
    headers: { ...privateHeaders, 'content-type': 'application/problem+json' },
  })
}

function parseQuery<T>(
  request: Request,
  schema: Schema<T>,
  repeatedKeys: readonly string[] = [],
): T | undefined {
  const values: Record<string, string | string[]> = {}
  for (const [key, value] of new URL(request.url).searchParams) {
    if (repeatedKeys.includes(key)) {
      const current = values[key]
      values[key] = Array.isArray(current) ? [...current, value] : [value]
    } else if (key in values) {
      return undefined
    } else {
      values[key] = value
    }
  }
  return schema.safeParse(values).data
}

async function requestBody<T>(request: Request, schema: Schema<T>): Promise<T | undefined> {
  try {
    return schema.safeParse(await request.json()).data
  } catch {
    return undefined
  }
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) {
    throw new Error('Place Backend returned an unsupported response')
  }
  return response.json()
}

export function createBrowserLibraryHttp(dependencies: Dependencies) {
  const invalid = () => problem(
    400,
    'PLACE_LIBRARY_REQUEST_INVALID',
    'Library request is invalid',
    dependencies.createCorrelationRef(),
    false,
  )
  const unavailable = () => problem(
    503,
    'PLACE_LIBRARY_WEB_UNAVAILABLE',
    'Library is temporarily unavailable',
    dependencies.createCorrelationRef(),
    true,
  )

  async function invoke<T>(
    request: Request,
    operation: (accessToken: string) => Promise<Response>,
    schema: Schema<T>,
    acceptedStatuses: readonly number[] = [200],
  ): Promise<Response> {
    const auth = dependencies.resolveAuthRuntime()
    if (auth === undefined) return unavailable()
    try {
      const session = await auth.bff.resolveSession(request)
      if (session === undefined) {
        return problem(
          401,
          'PLACE_AUTHENTICATION_REQUIRED',
          'Authentication required',
          dependencies.createCorrelationRef(),
          false,
        )
      }
      const response = await operation(session.tokens.accessToken)
      const value = await responseJson(response)
      if (acceptedStatuses.includes(response.status)) {
        const parsed = schema.safeParse(value)
        if (!parsed.success) return unavailable()
        return Response.json(parsed.data, {
          status: response.status,
          headers: privateHeaders,
        })
      }
      const safeProblem = problemSchema.safeParse(value).data
      if (
        safeProblem !== undefined &&
        [400, 401, 403, 404, 409, 503].includes(response.status)
      ) {
        return problem(
          response.status,
          safeProblem.code,
          safeProblem.title,
          safeProblem.correlationRef,
          safeProblem.retryable,
        )
      }
      return unavailable()
    } catch {
      return unavailable()
    }
  }

  return {
    async publicationCopyCommand(request: Request): Promise<Response> {
      const body = await requestBody(request, publishedCollectionCopyCommandRequestV2Schema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.publicationCopyCommand(
          accessToken,
          body,
          request.signal,
        ),
        publishedCollectionCopyCommandResultV2Schema,
        [200, 201, 404, 409, 422],
      )
    },
    async collectionCommand(request: Request): Promise<Response> {
      const body = await requestBody(request, collectionLifecycleCommandRequestV2Schema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.collectionCommand(
          accessToken,
          body,
          request.signal,
        ),
        collectionLifecycleCommandResultV2Schema,
        [200, 201, 404, 409, 422],
      )
    },
    workspace(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const allowed = new Set([
        'collectionId', 'rating', 'tagIds', 'tagMatch', 'areaKeys', 'taxonomyKeys',
        'collectionCursor', 'placeCursor', 'limit', 'collectionQuery', 'placeQuery', 'includeSelectedCollection',
      ])
      if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
        return Promise.resolve(invalid())
      }
      const single = (key: string) => {
        const values = url.searchParams.getAll(key)
        return values.length > 1 ? null : values[0]
      }
      const collectionId = single('collectionId')
      const rating = single('rating')
      const tagMatch = single('tagMatch')
      const collectionCursor = single('collectionCursor')
      const placeCursor = single('placeCursor')
      const limit = single('limit')
      const collectionQuery = single('collectionQuery')
      const placeQuery = single('placeQuery')
      const includeSelectedCollection = single('includeSelectedCollection')
      if ([collectionId, rating, tagMatch, collectionCursor, placeCursor, limit, collectionQuery, placeQuery, includeSelectedCollection].includes(null)) {
        return Promise.resolve(invalid())
      }
      const query = personalLibraryWorkspaceRequestV2Schema.safeParse({
        ...(includeSelectedCollection === undefined ? {} : {
          includeSelectedCollection: includeSelectedCollection === 'true' ? true : includeSelectedCollection,
        }),
        favoriteScope: collectionId === undefined
          ? { kind: 'all' }
          : { kind: 'collection', collectionId },
        ratingFilter: { kind: rating ?? 'any' },
        tagIds: url.searchParams.getAll('tagIds'),
        tagMatch: tagMatch ?? 'all',
        areaKeys: url.searchParams.getAll('areaKeys'),
        taxonomyKeys: url.searchParams.getAll('taxonomyKeys'),
        ...(collectionQuery === undefined ? {} : { collectionQuery }),
        ...(placeQuery === undefined ? {} : { placeQuery }),
        ...(collectionCursor === undefined ? {} : { collectionCursor }),
        ...(placeCursor === undefined ? {} : { placeCursor }),
        limit: limit ?? '20',
      }).data
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.workspace(accessToken, query, request.signal),
        personalLibraryWorkspaceResponseV2Schema,
      )
    },
    workspaceMap(request: Request): Promise<Response> {
      const query = parseQuery(request, personalLibraryMapHttpQueryV2Schema, ['tagIds', 'areaKeys', 'taxonomyKeys'])
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(request, (accessToken) => dependencies.backend.workspaceMap(accessToken, {
        favoriteScope: query.collectionId === undefined
          ? { kind: 'all' } : { kind: 'collection', collectionId: query.collectionId },
        ratingFilter: { kind: query.rating }, tagIds: query.tagIds, tagMatch: query.tagMatch,
        areaKeys: query.areaKeys, taxonomyKeys: query.taxonomyKeys,
        ...(query.placeQuery === undefined ? {} : { placeQuery: query.placeQuery }),
        west: query.west, south: query.south, east: query.east, north: query.north, zoom: query.zoom,
      }, request.signal), personalLibraryMapResponseV2Schema)
    },
    filing(request: Request, placeId: string): Promise<Response> {
      const identifier = libraryPlaceIdentifierParamsSchema.safeParse({ placeId }).data
      const query = parseQuery(request, placeFilingRequestV2Schema)
      if (identifier === undefined || query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.filing(
          accessToken,
          identifier.placeId,
          query,
          request.signal,
        ),
        placeFilingResponseV2Schema,
      )
    },
    async filingCommand(request: Request): Promise<Response> {
      const body = await requestBody(request, placeFilingCommandRequestV2Schema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.filingCommand(
          accessToken,
          body,
          request.signal,
        ),
        placeFilingCommandResultV2Schema,
        [200, 201, 404, 409, 422],
      )
    },
    map(request: Request): Promise<Response> {
      const query = parseQuery(
        request,
        libraryMapQuerySchema,
        ['tagIds', 'areaKeys', 'taxonomyKeys'],
      )
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.map(accessToken, query, request.signal),
        libraryMapResponseSchema,
      )
    },
    places(request: Request): Promise<Response> {
      const query = parseQuery(
        request,
        libraryPlaceListQuerySchema,
        ['tagIds', 'areaKeys', 'taxonomyKeys'],
      )
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.places(accessToken, query, request.signal),
        libraryPlaceListResponseSchema,
      )
    },
    facets(request: Request): Promise<Response> {
      if (parseQuery(request, libraryPlaceFacetsQuerySchema) === undefined) {
        return Promise.resolve(invalid())
      }
      return invoke(
        request,
        (accessToken) => dependencies.backend.facets(accessToken, request.signal),
        libraryPlaceFacetsResponseSchema,
      )
    },
    organization(request: Request, placeId: string): Promise<Response> {
      const identifier = libraryPlaceIdentifierParamsSchema.safeParse({ placeId }).data
      const query = parseQuery(request, libraryPlaceOrganizationQuerySchema)
      if (identifier === undefined || query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.organization(
          accessToken,
          identifier.placeId,
          query,
          request.signal,
        ),
        libraryPlaceOrganizationResponseSchema,
      )
    },
    collections(request: Request): Promise<Response> {
      const query = parseQuery(request, libraryCollectionListQuerySchema)
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.collections(accessToken, query, request.signal),
        libraryCollectionListResponseSchema,
      )
    },
    collection(request: Request, collectionId: string): Promise<Response> {
      const identifier = libraryCollectionIdentifierParamsSchema.safeParse({ collectionId }).data
      const query = parseQuery(request, libraryCollectionDetailQuerySchema)
      if (identifier === undefined || query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.collection(
          accessToken,
          identifier.collectionId,
          query,
          request.signal,
        ),
        libraryCollectionDetailResponseSchema,
      )
    },
    tags(request: Request): Promise<Response> {
      const query = parseQuery(request, libraryTagListQuerySchema)
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.tags(accessToken, query, request.signal),
        libraryTagListResponseSchema,
      )
    },
    async command(request: Request): Promise<Response> {
      const body = await requestBody(request, browserLibraryCommandRequestSchema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.command(accessToken, body, request.signal),
        libraryCommandResultSchema,
        [200, 201],
      )
    },
    place(request: Request, placeId: string): Promise<Response> {
      const identifier = placeIdentifierParamsSchema.safeParse({ placeId }).data
      if (identifier === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.place(accessToken, identifier.placeId, request.signal),
        placeDetailResponseSchema,
      )
    },
  }
}

export const browserLibraryHttp = createBrowserLibraryHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createLibraryBackendClient(),
  createCorrelationRef: randomUUID,
})
