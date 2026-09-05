import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  importAcquisitionCommandResultV1Schema,
  importAcquisitionCommandV1Schema,
  importAcquisitionIdentifierParamsV1Schema,
  importAcquisitionV1Schema,
  importPlanCommandRequestV2Schema,
  importPlanCommandResultV2Schema,
  importPlanCommandRequestV3Schema,
  importPlanCommandResultV3Schema,
  importPlanCommandRequestV4Schema,
  importPlanCommandResultV4Schema,
  importPlanIdentifierParamsV2Schema,
  importPlanIdentifierParamsV3Schema,
  importPlanIdentifierParamsV4Schema,
  importPlanV2Schema,
  importPlanV3Schema,
  importPlanV4Schema,
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
  sourceSnapshotDetailV3Schema,
  sourceSnapshotIdentifierParamsV3Schema,
  sourceSnapshotListQueryV3Schema,
  sourceSnapshotListV3Schema,
  startImportAcquisitionV1Schema,
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

export const browserTransferJsonByteLimits = Object.freeze({
  acquisitionRequest: 64 * 1_024,
  commandRequest: 512 * 1_024,
  acquisitionResponse: 512 * 1_024,
  defaultResponse: 16 * 1_024 * 1_024,
})

type BoundedJson =
  | Readonly<{ status: 'ok'; value: unknown }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'too-large' }>

function declaredLength(headers: Headers): number | undefined | 'invalid' {
  const value = headers.get('content-length')
  if (value === null) return undefined
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return 'invalid'
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 'invalid'
}

async function readBoundedJson(
  message: Request | Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<BoundedJson> {
  const mediaType = message.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') return { status: 'invalid' }
  const encoding = message.headers.get('content-encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'identity') return { status: 'invalid' }
  const length = declaredLength(message.headers)
  if (length === 'invalid') return { status: 'invalid' }
  if (length !== undefined && length > maximumBytes) return { status: 'too-large' }
  const wasAborted = () => signal?.aborted === true
  if (message.body === null || wasAborted()) return { status: 'invalid' }

  const reader = message.body.getReader()
  const release = async () => { try { await reader.cancel() } catch { /* best effort */ } }
  const abort = () => { void release() }
  signal?.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maximumBytes) {
        await release()
        return { status: 'too-large' }
      }
      chunks.push(next.value)
    }
  } catch {
    await release()
    return { status: 'invalid' }
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  if (wasAborted()) return { status: 'invalid' }
  try {
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { status: 'ok', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { status: 'invalid' }
  }
}

async function body<T>(request: Request, schema: Schema<T>): Promise<T | undefined> {
  const read = await readBoundedJson(request, browserTransferJsonByteLimits.commandRequest, request.signal)
  return read.status === 'ok' ? schema.safeParse(read.value).data : undefined
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

export function createBrowserTransferHttp(dependencies: Dependencies) {
  const invalid = () => problem(400, 'PLACE_TRANSFER_REQUEST_INVALID', 'Transfer request is invalid', dependencies.createCorrelationRef(), false)
  const tooLarge = () => problem(413, 'PLACE_TRANSFER_REQUEST_TOO_LARGE', 'Transfer request is too large', dependencies.createCorrelationRef(), false)
  const unavailable = () => problem(503, 'PLACE_TRANSFER_WEB_UNAVAILABLE', 'Transfer settings are temporarily unavailable', dependencies.createCorrelationRef(), true)

  async function invoke<T>(
    request: Request,
    operation: (accessToken: string) => Promise<Response | Readonly<{ earlyResponse: Response }>>,
    schema: Schema<T>,
    acceptedStatuses: readonly number[] = [200],
    maximumResponseBytes = browserTransferJsonByteLimits.defaultResponse,
  ): Promise<Response> {
    const auth = dependencies.resolveAuthRuntime()
    if (auth === undefined) return unavailable()
    try {
      const session = await auth.bff.resolveSession(request)
      if (session === undefined) return problem(401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required', dependencies.createCorrelationRef(), false)
      const outcome = await operation(session.tokens.accessToken)
      if ('earlyResponse' in outcome) return outcome.earlyResponse
      const response = outcome
      const read = await readBoundedJson(response, maximumResponseBytes, request.signal)
      if (read.status !== 'ok') return unavailable()
      const value = read.value
      if (acceptedStatuses.includes(response.status)) {
        const parsed = schema.safeParse(value)
        return parsed.success
          ? Response.json(parsed.data, { status: response.status, headers: privateHeaders })
          : unavailable()
      }
      const safeProblem = problemSchema.safeParse(value).data
      if (safeProblem !== undefined && [400, 401, 403, 404, 409, 413, 422, 429, 503].includes(response.status)) {
        return problem(response.status, safeProblem.code, safeProblem.title, safeProblem.correlationRef, safeProblem.retryable)
      }
      return unavailable()
    } catch { return unavailable() }
  }

  async function acquisitionCommand<T>(
    request: Request,
    requestSchema: Schema<T>,
    operation: (accessToken: string, input: T) => Promise<Response>,
  ): Promise<Response> {
    return invoke(request, async (accessToken) => {
      const read = await readBoundedJson(request, browserTransferJsonByteLimits.acquisitionRequest, request.signal)
      if (read.status === 'too-large') return { earlyResponse: tooLarge() }
      if (read.status === 'invalid') return { earlyResponse: invalid() }
      const parsedInput = requestSchema.safeParse(read.value).data
      if (parsedInput === undefined) {
        return { earlyResponse: invalid() }
      }
      return operation(accessToken, parsedInput)
    }, importAcquisitionCommandResultV1Schema,
    [200, 201, 404, 409, 422, 429], browserTransferJsonByteLimits.acquisitionResponse)
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
    async startImportAcquisition(request: Request) {
      return acquisitionCommand(request, startImportAcquisitionV1Schema,
        (token, input) => dependencies.backend.startImportAcquisition(token, input, request.signal))
    },
    importAcquisition(request: Request, acquisitionId: string) {
      const identifier = importAcquisitionIdentifierParamsV1Schema.safeParse({ acquisitionId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.importAcquisition(token, identifier.data.acquisitionId, request.signal), importAcquisitionV1Schema) : Promise.resolve(invalid())
    },
    async importAcquisitionCommand(request: Request) {
      return acquisitionCommand(request, importAcquisitionCommandV1Schema,
        (token, input) => dependencies.backend.importAcquisitionCommand(token, input, request.signal))
    },
    snapshotsV3(request: Request) {
      const url = new URL(request.url)
      const parsed = sourceSnapshotListQueryV3Schema.safeParse({
        importSourceId: url.searchParams.get('importSourceId') ?? undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      })
      if (!parsed.success || [...url.searchParams.keys()].some((key) => !['importSourceId', 'cursor', 'limit'].includes(key))) return Promise.resolve(invalid())
      return invoke(request, (token) => dependencies.backend.snapshotsV3(token, parsed.data, request.signal), sourceSnapshotListV3Schema)
    },
    snapshotV3(request: Request, snapshotId: string) {
      const identifier = sourceSnapshotIdentifierParamsV3Schema.safeParse({ snapshotId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.snapshotV3(token, identifier.data.snapshotId, request.signal), sourceSnapshotDetailV3Schema) : Promise.resolve(invalid())
    },
    async importPlanCommand(request: Request) {
      const input = await body(request, importPlanCommandRequestV2Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.importPlanCommand(token, input, request.signal), importPlanCommandResultV2Schema, [200, 201, 404, 409, 422])
    },
    importPlan(request: Request, planId: string) {
      const identifier = importPlanIdentifierParamsV2Schema.safeParse({ planId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.importPlan(token, identifier.data.planId, request.signal), importPlanV2Schema) : Promise.resolve(invalid())
    },
    async importPlanCommandV3(request: Request) {
      const input = await body(request, importPlanCommandRequestV3Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.importPlanCommandV3(token, input, request.signal), importPlanCommandResultV3Schema, [200, 201, 404, 409, 422])
    },
    importPlanV3(request: Request, planId: string) {
      const identifier = importPlanIdentifierParamsV3Schema.safeParse({ planId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.importPlanV3(token, identifier.data.planId, request.signal), importPlanV3Schema) : Promise.resolve(invalid())
    },
    async importPlanCommandV4(request: Request) {
      const input = await body(request, importPlanCommandRequestV4Schema)
      return input === undefined ? invalid() : invoke(request, (token) => dependencies.backend.importPlanCommandV4(token, input, request.signal), importPlanCommandResultV4Schema, [200, 201, 404, 409, 422])
    },
    importPlanV4(request: Request, planId: string) {
      const identifier = importPlanIdentifierParamsV4Schema.safeParse({ planId })
      return identifier.success ? invoke(request, (token) => dependencies.backend.importPlanV4(token, identifier.data.planId, request.signal), importPlanV4Schema) : Promise.resolve(invalid())
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
