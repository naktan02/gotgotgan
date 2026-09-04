import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  connectorImportGrantRequestV2Schema,
  connectorImportGrantResultV2Schema,
  outboundExecutionGrantRequestV2Schema,
  outboundExecutionGrantResultV2Schema,
} from '@place/contracts/transfers'

import type { createOidcBff } from '../../../auth/oidc-bff'
import { readNextOidcRuntime } from '../../../auth/next-oidc-lifecycle'
import { readNextConnectorTransferRuntime } from '../runtime/next-connector-lifecycle'
import { readBoundedJson } from './bounded-json'
import type { ConnectorTransferBackendClient } from './connector-transfer-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type Schema<T> = Readonly<{
  safeParse(value: unknown):
    | Readonly<{ success: true; data: T }>
    | Readonly<{ success: false; data?: undefined }>
}>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  resolveBackend: () => ConnectorTransferBackendClient | undefined
  createCorrelationRef: () => string
}>
type ParsedBody<T> = Readonly<{ data: T }> | Readonly<{ response: Response }>

const maximumControlRequestBytes = 512 * 1_024
const maximumControlResponseBytes = 2 * 1_024 * 1_024
const maximumGrantResponseBytes = 140 * 1_024 * 1_024
const safeProblemStatuses = new Set([400, 401, 403, 404, 409, 413, 422, 429, 503])
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
  retryable: boolean,
): Response {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, {
    status,
    headers: { ...privateHeaders, 'content-type': 'application/problem+json' },
  })
}

function hasOnlyExpectedUrl(request: Request, publicOrigin: string): boolean {
  const url = new URL(request.url)
  return request.headers.get('origin') === publicOrigin && url.search === ''
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

export function createBrowserConnectorTransferHttp(dependencies: Dependencies) {
  const localProblem = (
    status: number,
    code: string,
    title: string,
    retryable = status === 503,
  ) => problem(status, code, title, dependencies.createCorrelationRef(), retryable)
  const invalid = () => localProblem(
    400, 'PLACE_CONNECTOR_TRANSFER_REQUEST_INVALID', 'Connector transfer request is invalid', false,
  )
  const tooLarge = () => localProblem(
    413, 'PLACE_CONNECTOR_TRANSFER_REQUEST_TOO_LARGE', 'Connector transfer request is too large', false,
  )
  const unavailable = () => localProblem(
    503, 'PLACE_CONNECTOR_TRANSFER_WEB_UNAVAILABLE',
    'Connector transfer is temporarily unavailable', true,
  )
  const originDenied = () => localProblem(
    403, 'PLACE_CONNECTOR_ORIGIN_DENIED', 'Connector request origin is not allowed', false,
  )

  async function parseBody<T>(
    request: Request,
    schema: Schema<T>,
    maximumBytes: number,
  ): Promise<ParsedBody<T>> {
    const read = await readBoundedJson(request, maximumBytes)
    if (read.status === 'too-large') return { response: tooLarge() } as const
    if (read.status === 'invalid') return { response: invalid() } as const
    const parsed = schema.safeParse(read.value)
    return parsed.success ? { data: parsed.data } as const : { response: invalid() } as const
  }

  async function response<T>(
    operation: () => Promise<Response>,
    schema: Schema<T>,
    acceptedStatuses: readonly number[] = [200],
    maximumBytes = maximumControlResponseBytes,
  ): Promise<Response> {
    try {
      const backendResponse = await operation()
      const read = await readBoundedJson(backendResponse, maximumBytes)
      if (read.status !== 'ok') return unavailable()
      if (acceptedStatuses.includes(backendResponse.status)) {
        const parsed = schema.safeParse(read.value)
        if (parsed.success) {
          return Response.json(parsed.data, {
            status: backendResponse.status,
            headers: privateHeaders,
          })
        }
      }
      const safe = safeProblem(read.value, backendResponse.status)
      return safe === undefined
        ? unavailable()
        : problem(safe.status, safe.code, safe.title, safe.correlationRef, safe.retryable)
    } catch {
      return unavailable()
    }
  }

  async function memberGrant<T>(input: Readonly<{
    request: Request
    schema: Schema<T>
    placeOrigin(value: T): string
    invoke(backend: ConnectorTransferBackendClient, token: string, value: T): Promise<Response>
    responseSchema: Schema<unknown>
  }>): Promise<Response> {
    const auth = dependencies.resolveAuthRuntime()
    const backend = dependencies.resolveBackend()
    if (auth === undefined || backend === undefined) return unavailable()
    if (!hasOnlyExpectedUrl(input.request, backend.publicOrigin)) return originDenied()
    try {
      const session = await auth.bff.resolveSession(input.request)
      if (session === undefined) {
        return localProblem(
          401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required', false,
        )
      }
      const parsed = await parseBody(input.request, input.schema, maximumControlRequestBytes)
      if ('response' in parsed) return parsed.response
      if (input.placeOrigin(parsed.data) !== backend.publicOrigin) return originDenied()
      return response(
        () => input.invoke(backend, session.tokens.accessToken, parsed.data),
        input.responseSchema,
        [200, 409],
        maximumGrantResponseBytes,
      )
    } catch {
      return unavailable()
    }
  }

  return Object.freeze({
    issueImportGrant: (request: Request) => memberGrant({
      request, schema: connectorImportGrantRequestV2Schema,
      placeOrigin: (value) => value.placeOrigin,
      invoke: (backend, token, value) => backend.issueImportGrant(token, value, request.signal),
      responseSchema: connectorImportGrantResultV2Schema,
    }),
    issueOutboundGrant: (request: Request) => memberGrant({
      request, schema: outboundExecutionGrantRequestV2Schema,
      placeOrigin: (value) => value.placeOrigin,
      invoke: (backend, token, value) => backend.issueOutboundGrant(token, value, request.signal),
      responseSchema: outboundExecutionGrantResultV2Schema,
    }),
  })
}

export const browserConnectorTransferHttp = createBrowserConnectorTransferHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  resolveBackend: readNextConnectorTransferRuntime,
  createCorrelationRef: randomUUID,
})
