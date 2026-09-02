import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  importPlanCommandRequestV2Schema,
  importPlanCommandResultV2Schema,
  importPlanIdentifierParamsV2Schema,
  importPlanV2Schema,
  outboundTransferCommandRequestV2Schema,
  outboundTransferCommandResultV2Schema,
  outboundTransferIdentifierParamsV2Schema,
  outboundTransferV2Schema,
  providerCapabilityListV2Schema,
  providerConnectionCommandRequestV2Schema,
  providerConnectionCommandResultV2Schema,
  providerConnectionIdentifierParamsV2Schema,
  providerConnectionListV2Schema,
  providerTargetListProjectionV2Schema,
  sourceSnapshotDetailV2Schema,
  sourceSnapshotIdentifierParamsV2Schema,
  sourceSnapshotListQueryV2Schema,
  sourceSnapshotListV2Schema,
} from '@place/contracts/transfers'

import type { createOidcBff } from '../../auth/oidc-bff'
import { readNextOidcRuntime } from '../../auth/next-oidc-lifecycle'
import {
  createTransferBackendClient,
  type TransferBackendClient,
} from './transfer-backend-client'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  backend: TransferBackendClient
  createCorrelationRef: () => string
}>
type Schema<T> = Readonly<{
  safeParse(value: unknown):
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
) {
  return Response.json({
    type: `urn:place:error:${code.toLowerCase().replace(/^place_/, '').replaceAll('_', '-')}`,
    title, status, code, retryable, correlationRef,
  }, { status, headers: { ...privateHeaders, 'content-type': 'application/problem+json' } })
}

async function body<T>(request: Request, schema: Schema<T>): Promise<T | undefined> {
  try { return schema.safeParse(await request.json()).data } catch { return undefined }
}

async function json(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('Unsupported response')
  return response.json()
}

export function createBrowserTransferHttp(dependencies: Dependencies) {
  const invalid = () => problem(400, 'PLACE_TRANSFER_REQUEST_INVALID', 'Transfer request is invalid', dependencies.createCorrelationRef(), false)
  const unavailable = () => problem(503, 'PLACE_TRANSFER_WEB_UNAVAILABLE', 'Transfer settings are temporarily unavailable', dependencies.createCorrelationRef(), true)

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
      if (session === undefined) return problem(401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required', dependencies.createCorrelationRef(), false)
      const response = await operation(session.tokens.accessToken)
      const value = await json(response)
      if (acceptedStatuses.includes(response.status)) {
        const parsed = schema.safeParse(value)
        return parsed.success
          ? Response.json(parsed.data, { status: response.status, headers: privateHeaders })
          : unavailable()
      }
      const safeProblem = problemSchema.safeParse(value).data
      if (safeProblem !== undefined && [400, 401, 403, 404, 409, 422, 503].includes(response.status)) {
        return problem(response.status, safeProblem.code, safeProblem.title, safeProblem.correlationRef, safeProblem.retryable)
      }
      return unavailable()
    } catch { return unavailable() }
  }

  return {
    capabilities: (request: Request) => invoke(request, (token) => dependencies.backend.capabilities(token, request.signal), providerCapabilityListV2Schema),
    connections: (request: Request) => invoke(request, (token) => dependencies.backend.connections(token, request.signal), providerConnectionListV2Schema),
    targetLists(request: Request, connectionId: string) {
      const identifier = providerConnectionIdentifierParamsV2Schema.safeParse({ connectionId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.targetLists(token, identifier.data.connectionId, request.signal), providerTargetListProjectionV2Schema) : Promise.resolve(invalid())
    },
    async connectionCommand(request: Request) {
      const input = await body(request, providerConnectionCommandRequestV2Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.connectionCommand(token, input, request.signal), providerConnectionCommandResultV2Schema, [200, 201, 404, 409, 422])
    },
    snapshots(request: Request) {
      const url = new URL(request.url)
      const parsed = sourceSnapshotListQueryV2Schema.safeParse({
        connectionId: url.searchParams.get('connectionId') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      })
      if (!parsed.success || [...url.searchParams.keys()].some((key) => !['connectionId', 'limit'].includes(key))) return Promise.resolve(invalid())
      if (parsed.data.connectionId === undefined) return Promise.resolve(invalid())
      return invoke(request, (token) => dependencies.backend.snapshots(token, parsed.data.connectionId!, request.signal), sourceSnapshotListV2Schema)
    },
    snapshot(request: Request, snapshotId: string) {
      const identifier = sourceSnapshotIdentifierParamsV2Schema.safeParse({ snapshotId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.snapshot(token, identifier.data.snapshotId, request.signal), sourceSnapshotDetailV2Schema) : Promise.resolve(invalid())
    },
    async importPlanCommand(request: Request) {
      const input = await body(request, importPlanCommandRequestV2Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.importPlanCommand(token, input, request.signal), importPlanCommandResultV2Schema, [200, 201, 404, 409, 422])
    },
    importPlan(request: Request, planId: string) {
      const identifier = importPlanIdentifierParamsV2Schema.safeParse({ planId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.importPlan(token, identifier.data.planId, request.signal), importPlanV2Schema) : Promise.resolve(invalid())
    },
    async outboundTransferCommand(request: Request) {
      const input = await body(request, outboundTransferCommandRequestV2Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.outboundTransferCommand(token, input, request.signal), outboundTransferCommandResultV2Schema, [200, 201, 404, 409, 422])
    },
    outboundTransfer(request: Request, transferId: string) {
      const identifier = outboundTransferIdentifierParamsV2Schema.safeParse({ transferId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.outboundTransfer(token, identifier.data.transferId, request.signal), outboundTransferV2Schema) : Promise.resolve(invalid())
    },
  }
}

export const browserTransferHttp = createBrowserTransferHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  backend: createTransferBackendClient(),
  createCorrelationRef: randomUUID,
})
