import { randomUUID } from 'node:crypto'

import {
  libraryCommandRequestSchema,
  placeIdentifierParamsSchema,
  problemSchema,
} from '@place/contracts/http'
import {
  libraryCollectionDetailQuerySchema,
  libraryCollectionDetailResponseSchema,
  libraryCollectionIdentifierParamsSchema,
  libraryCollectionListQuerySchema,
  libraryCollectionListResponseSchema,
  libraryCommandResultSchema,
  libraryPlaceListQuerySchema,
  libraryPlaceListResponseSchema,
  libraryTagListQuerySchema,
  libraryTagListResponseSchema,
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
      if (response.ok && acceptedStatuses.includes(response.status)) {
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
    places(request: Request): Promise<Response> {
      const query = parseQuery(request, libraryPlaceListQuerySchema, ['tagIds'])
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.places(accessToken, query, request.signal),
        libraryPlaceListResponseSchema,
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
      const body = await requestBody(request, libraryCommandRequestSchema)
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
