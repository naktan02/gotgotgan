import { randomUUID } from 'node:crypto'

import {
  browserPrivateNoteCommandRequestSchema,
  problemSchema,
  type BrowserPrivateNoteCommandRequest,
  type WritingCommandRequest,
} from '@place/contracts/http'
import {
  writingCommandResultSchema,
  writingDetailResponseSchema,
  writingDocumentIdentifierParamsSchema,
  writingListQuerySchema,
  writingListResponseSchema,
  type WritingListQuery,
  type WritingListResponse,
} from '@place/contracts/writing'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import {
  createWritingBackendClient,
  type WritingBackendClient,
} from './writing-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: WritingBackendClient
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

function backendCommand(request: BrowserPrivateNoteCommandRequest): WritingCommandRequest {
  return {
    commandId: request.commandId,
    command: { ...request.command, visibility: 'private' },
  }
}

function pageForQuery(query: WritingListQuery): Schema<WritingListResponse> {
  return {
    safeParse(value) {
      const parsed = writingListResponseSchema.safeParse(value)
      if (
        !parsed.success || parsed.data.filter.kind !== query.kind ||
        parsed.data.filter.placeId !== query.placeId ||
        !parsed.data.items.every((item) => (
          (query.kind === 'all' || item.kind === query.kind) &&
          (query.placeId === undefined || item.placeIds.includes(query.placeId))
        ))
      ) return { success: false }
      return parsed
    },
  }
}

export function createBrowserWritingHttp(dependencies: Dependencies) {
  const invalid = () => problem(
    400,
    'PLACE_WRITING_REQUEST_INVALID',
    'Writing request is invalid',
    dependencies.createCorrelationRef(),
    false,
  )
  const unavailable = () => problem(
    503,
    'PLACE_WRITING_WEB_UNAVAILABLE',
    'Writing is temporarily unavailable',
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
      if (safeProblem !== undefined && [400, 401, 403, 404, 409, 503].includes(response.status)) {
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
    list(request: Request): Promise<Response> {
      const query = parseQuery(request, writingListQuerySchema)
      if (query === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.list(accessToken, query, request.signal),
        pageForQuery(query),
        [200],
      )
    },
    detail(request: Request, documentId: string): Promise<Response> {
      const identifier = writingDocumentIdentifierParamsSchema.safeParse({ documentId }).data
      if (identifier === undefined) return Promise.resolve(invalid())
      return invoke(
        request,
        (accessToken) => dependencies.backend.detail(
          accessToken,
          identifier.documentId,
          request.signal,
        ),
        writingDetailResponseSchema,
        [200],
      )
    },
    async command(request: Request): Promise<Response> {
      const body = await requestBody(request, browserPrivateNoteCommandRequestSchema)
      if (body === undefined) return invalid()
      return invoke(
        request,
        (accessToken) => dependencies.backend.command(
          accessToken,
          backendCommand(body),
          request.signal,
        ),
        writingCommandResultSchema,
        [200, 201],
      )
    },
  }
}

export const browserWritingHttp = createBrowserWritingHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createWritingBackendClient(),
  createCorrelationRef: randomUUID,
})
