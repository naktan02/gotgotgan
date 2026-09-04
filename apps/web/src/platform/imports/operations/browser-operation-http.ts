import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  transferOperationCommandRequestV2Schema,
  transferOperationCommandResultV2Schema,
  transferOperationIdentifierParamsV2Schema,
  transferOperationItemPageV2Schema,
  transferOperationItemQueryV2Schema,
  transferOperationListQueryV2Schema,
  transferOperationListV2Schema,
  transferOperationSummaryV2Schema,
  transferOperationV2Schema,
} from '@place/contracts/transfers'

import type { createOidcBff } from '../../auth/oidc-bff'
import { readNextOidcRuntime } from '../../auth/next-oidc-lifecycle'
import {
  createOperationBackendClient,
  type OperationBackendClient,
} from './operation-backend-client'
import { operationJsonByteLimits, readOperationJson } from './operation-json-envelope'

type AuthRuntime = Readonly<{ bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'> }>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: OperationBackendClient
  createCorrelationRef: () => string
}>
type Schema<T> = Readonly<{
  safeParse(value: unknown): Readonly<{ success: true; data: T }> | Readonly<{ success: false; data?: undefined }>
}>

const privateHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}
const safeProblemStatuses = new Set([400, 401, 403, 404, 409, 413, 422, 429, 503])

function problem(status: number, code: string, title: string, correlationRef: string, retryable = status === 409 || status === 503) {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, { status, headers: { ...privateHeaders, 'content-type': 'application/problem+json' } })
}

function safeProblem(value: unknown, status: number) {
  const parsed = problemSchema.safeParse(value).data
  if (
    parsed === undefined || parsed.status !== status || !safeProblemStatuses.has(status) ||
    parsed.type.length > 512 || parsed.title.length > 200 || parsed.code.length > 120 ||
    parsed.correlationRef.length > 512
  ) return undefined
  return parsed
}

export function createBrowserOperationHttp(dependencies: Dependencies) {
  const invalid = () => problem(400, 'PLACE_OPERATION_REQUEST_INVALID', 'Operation request is invalid', dependencies.createCorrelationRef(), false)
  const unavailable = () => problem(503, 'PLACE_OPERATION_WEB_UNAVAILABLE', 'Operation history is temporarily unavailable', dependencies.createCorrelationRef(), true)

  async function invoke<T>(
    request: Request,
    operation: (accessToken: string) => Promise<Response>,
    schema: Schema<T>,
    acceptedStatuses: readonly number[] = [200],
    maximumResponseBytes = operationJsonByteLimits.detailResponse,
  ): Promise<Response> {
    const auth = dependencies.resolveAuthRuntime()
    if (auth === undefined) return unavailable()
    try {
      const session = await auth.bff.resolveSession(request)
      if (session === undefined) return problem(401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required', dependencies.createCorrelationRef(), false)
      const response = await operation(session.tokens.accessToken)
      const read = await readOperationJson(response, maximumResponseBytes, request.signal)
      if (read.status !== 'ok') return unavailable()
      if (acceptedStatuses.includes(response.status)) {
        const parsed = schema.safeParse(read.value)
        if (parsed.success) return Response.json(parsed.data, { status: response.status, headers: privateHeaders })
      }
      const safe = safeProblem(read.value, response.status)
      return safe === undefined
        ? unavailable()
        : problem(safe.status, safe.code, safe.title, safe.correlationRef, safe.retryable)
    } catch { return unavailable() }
  }

  return {
    list(request: Request) {
      const url = new URL(request.url)
      const parsed = transferOperationListQueryV2Schema.safeParse({
        kind: url.searchParams.get('kind') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      })
      if (!parsed.success || [...url.searchParams.keys()].some((key) => !['kind', 'state', 'cursor', 'limit'].includes(key))) return Promise.resolve(invalid())
      const query = new URLSearchParams({ limit: String(parsed.data.limit) })
      if (parsed.data.kind !== undefined) query.set('kind', parsed.data.kind)
      if (parsed.data.state !== undefined) query.set('state', parsed.data.state)
      if (parsed.data.cursor !== undefined) query.set('cursor', parsed.data.cursor)
      return invoke(request, (token) => dependencies.backend.list(token, `?${query}`, request.signal), transferOperationListV2Schema, [200], operationJsonByteLimits.listResponse)
    },
    summary: (request: Request) => invoke(request, (token) => dependencies.backend.summary(token, request.signal), transferOperationSummaryV2Schema, [200], operationJsonByteLimits.summaryResponse),
    detail(request: Request, operationId: string) {
      const identifier = transferOperationIdentifierParamsV2Schema.safeParse({ operationId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.detail(token, identifier.data.operationId, request.signal), transferOperationV2Schema, [200], operationJsonByteLimits.detailResponse) : Promise.resolve(invalid())
    },
    items(request: Request, operationId: string) {
      const identifier = transferOperationIdentifierParamsV2Schema.safeParse({ operationId })
      const url = new URL(request.url)
      const queryValue = transferOperationItemQueryV2Schema.safeParse({
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      })
      if (!identifier.success || !queryValue.success || [...url.searchParams.keys()].some((key) => !['cursor', 'limit'].includes(key))) return Promise.resolve(invalid())
      const query = new URLSearchParams({ limit: String(queryValue.data.limit) })
      if (queryValue.data.cursor !== undefined) query.set('cursor', queryValue.data.cursor)
      return invoke(request, (token) => dependencies.backend.items(token, identifier.data.operationId, `?${query}`, request.signal), transferOperationItemPageV2Schema, [200], operationJsonByteLimits.itemsResponse)
    },
    async command(request: Request) {
      const read = await readOperationJson(
        request, operationJsonByteLimits.commandRequest, request.signal,
      )
      if (read.status === 'too-large') return problem(413, 'PLACE_OPERATION_REQUEST_TOO_LARGE', 'Operation request is too large', dependencies.createCorrelationRef(), false)
      if (read.status !== 'ok') return invalid()
      const parsed = transferOperationCommandRequestV2Schema.safeParse(read.value)
      return !parsed.success ? invalid() : invoke(request, (token) => dependencies.backend.command(token, parsed.data, request.signal), transferOperationCommandResultV2Schema, [200, 201, 404, 409, 422], operationJsonByteLimits.commandResponse)
    },
  }
}

export const browserOperationHttp = createBrowserOperationHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createOperationBackendClient(),
  createCorrelationRef: randomUUID,
})
