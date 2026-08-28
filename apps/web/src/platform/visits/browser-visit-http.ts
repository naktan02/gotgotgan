import { randomUUID } from 'node:crypto'

import {
  browserVisitRecordRequestSchema,
  placeIdentifierParamsSchema,
  problemSchema,
} from '@place/contracts/http'
import {
  visitHistoryQuerySchema,
  visitHistoryResponseSchema,
  visitRecordResultSchema,
} from '@place/contracts/visits'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import {
  createVisitBackendClient,
  type VisitBackendClient,
} from './visit-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: VisitBackendClient
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

function parseQuery<T>(request: Request, schema: Schema<T>): T | undefined {
  const values: Record<string, string> = {}
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in values) return undefined
    values[key] = value
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

export function createBrowserVisitHttp(dependencies: Dependencies) {
  const invalid = () => problem(
    400,
    'PLACE_VISIT_REQUEST_INVALID',
    'Visit request is invalid',
    dependencies.createCorrelationRef(),
    false,
  )
  const unavailable = () => problem(
    503,
    'PLACE_VISIT_WEB_UNAVAILABLE',
    'Visits are temporarily unavailable',
    dependencies.createCorrelationRef(),
    true,
  )

  async function invoke<T>(
    request: Request,
    operation: (accessToken: string) => Promise<Response>,
    schema: Schema<T>,
    acceptedStatuses: readonly number[],
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
        return Response.json(parsed.data, { status: response.status, headers: privateHeaders })
      }
      const safeProblem = problemSchema.safeParse(value).data
      if (
        safeProblem !== undefined &&
        [400, 401, 403, 409, 503].includes(response.status)
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
    history(request: Request, placeId: string): Promise<Response> {
      const identifier = placeIdentifierParamsSchema.safeParse({ placeId }).data
      const query = parseQuery(request, visitHistoryQuerySchema)
      if (identifier === undefined || query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.history(
          accessToken,
          identifier.placeId,
          query,
          request.signal,
        ),
        visitHistoryResponseSchema,
        [200],
      )
    },
    async record(request: Request): Promise<Response> {
      const body = await requestBody(request, browserVisitRecordRequestSchema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.record(accessToken, body, request.signal),
        visitRecordResultSchema,
        [201],
      )
    },
  }
}

export const browserVisitHttp = createBrowserVisitHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createVisitBackendClient(),
  createCorrelationRef: randomUUID,
})
