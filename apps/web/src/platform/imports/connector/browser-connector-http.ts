import { randomUUID } from 'node:crypto'

import {
  connectorCaptureBatchSchema,
  connectorCaptureReceiptSchema,
  connectorGrantRequestSchema,
  connectorGrantSchema,
} from '@place/contracts/connector'
import { problemSchema } from '@place/contracts/http'

import type { createOidcBff } from '../../auth/oidc-bff'
import { readNextOidcRuntime } from '../../auth/next-oidc-lifecycle'
import type { createConnectorBackendClient } from './connector-backend-client'
import { readNextConnectorRuntime } from './next-connector-lifecycle'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type ConnectorBackend = ReturnType<typeof createConnectorBackendClient>

function problem(
  status: number,
  code: string,
  title: string,
  correlationRef: string,
  retryable = status === 503,
): Response {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, {
    status,
    headers: {
      'cache-control': 'no-store', 'content-type': 'application/problem+json',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    },
  })
}

export function createBrowserConnectorHttp(dependencies: Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  resolveConnectorBackend: () => ConnectorBackend | undefined
  createCorrelationRef: () => string
}>) {
  const unavailable = () => problem(
    503, 'PLACE_CONNECTOR_UNAVAILABLE', '브라우저 가져오기를 현재 사용할 수 없습니다.',
    dependencies.createCorrelationRef(), true,
  )
  const invalid = () => problem(
    400, 'PLACE_CONNECTOR_REQUEST_INVALID', '브라우저 가져오기 요청이 올바르지 않습니다.',
    dependencies.createCorrelationRef(), false,
  )

  async function responseJson(response: Response): Promise<unknown> {
    if (!response.headers.get('content-type')?.includes('json')) throw new Error('unsupported response')
    return response.json()
  }

  async function rejected(response: Response): Promise<Response> {
    const payload = problemSchema.safeParse(await responseJson(response)).data
    if (payload === undefined || ![400, 401, 403, 409, 503].includes(response.status)) {
      return unavailable()
    }
    return problem(
      response.status, payload.code, payload.title, payload.correlationRef, payload.retryable,
    )
  }

  return {
    async issueGrant(request: Request): Promise<Response> {
      const auth = dependencies.resolveAuthRuntime()
      const backend = dependencies.resolveConnectorBackend()
      if (auth === undefined || backend === undefined) return unavailable()
      let body: ReturnType<typeof connectorGrantRequestSchema.parse>
      try {
        body = connectorGrantRequestSchema.parse(await request.json())
      } catch {
        return invalid()
      }
      try {
        const session = await auth.bff.resolveSession(request)
        if (session === undefined) {
          return problem(
            401, 'PLACE_AUTHENTICATION_REQUIRED', '로그인이 필요합니다.',
            dependencies.createCorrelationRef(), false,
          )
        }
        const publicOrigin = new URL(request.url).origin
        const response = await backend.issueGrant(session.tokens.accessToken, body, publicOrigin)
        if (!response.ok) return rejected(response)
        const grant = connectorGrantSchema.safeParse(await responseJson(response)).data
        if (
          grant === undefined || grant.placeOrigin !== publicOrigin ||
          grant.providerKey !== body.providerKey || grant.operation !== body.operation ||
          grant.idempotencyKey !== body.idempotencyKey
        ) return unavailable()
        return Response.json(grant, {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        })
      } catch {
        return unavailable()
      }
    },

    async submitCapture(request: Request): Promise<Response> {
      const backend = dependencies.resolveConnectorBackend()
      if (backend === undefined) return unavailable()
      const authorization = request.headers.get('authorization')
      if (authorization === null || !/^PlaceConnector [A-Za-z0-9._~-]{32,8192}$/.test(authorization)) {
        return invalid()
      }
      let batch
      try {
        batch = connectorCaptureBatchSchema.parse(await request.json())
      } catch {
        return invalid()
      }
      if (request.headers.get('x-place-connector-operation') !== batch.operationId) return invalid()
      try {
        const response = await backend.submitCapture(
          authorization, batch, new URL(request.url).origin,
        )
        if (!response.ok) return rejected(response)
        const receipt = connectorCaptureReceiptSchema.safeParse(await responseJson(response)).data
        if (
          receipt === undefined || receipt.operationId !== batch.operationId ||
          receipt.acceptedSequence !== batch.sequence ||
          receipt.acceptedChecksum !== batch.checksum
        ) return unavailable()
        return Response.json(receipt, {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        })
      } catch {
        return unavailable()
      }
    },
  }
}

export const browserConnectorHttp = createBrowserConnectorHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  resolveConnectorBackend: readNextConnectorRuntime,
  createCorrelationRef: randomUUID,
})
