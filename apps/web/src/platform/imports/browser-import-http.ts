import { randomUUID } from 'node:crypto'

import { problemSchema } from '@place/contracts/http'
import {
  placeImportBatchDetailSchema,
  placeImportBatchSchema,
  placeImportCancelRequestSchema,
  placeImportRequestSchema,
  placeImportResumeRequestSchema,
  placeImportReviewRequestSchema,
  placeImportReviewResultSchema,
  providerConnectionListSchema,
} from '@place/contracts/imports'

import type { createOidcBff } from '../auth/oidc-bff'
import { readNextOidcRuntime } from '../auth/next-oidc-lifecycle'
import type { createImportBackendClient } from './import-backend-client'
import { readNextImportRuntime } from './next-import-lifecycle'

type AuthRuntime = Readonly<{
  bff: Pick<ReturnType<typeof createOidcBff>, 'resolveSession'>
}>
type ImportBackend = ReturnType<typeof createImportBackendClient>
type Dependencies = Readonly<{
  resolveAuthRuntime: () => AuthRuntime | undefined
  resolveImportBackend: () => ImportBackend | undefined
  createCorrelationRef: () => string
}>
type SessionContext = Readonly<{ backend: ImportBackend; accessToken: string }>

const batchIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
    title, status, code, retryable, correlationRef,
  }, {
    status,
    headers: {
      'cache-control': 'no-store', 'content-type': 'application/problem+json',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    },
  })
}

function connectionProjection(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  return providerConnectionListSchema.safeParse({
    schemaVersion: value.schemaVersion,
    items: value.items.map((item) => isRecord(item) ? {
      schemaVersion: item.schemaVersion, connectionId: item.connectionId,
      providerKey: item.providerKey, label: item.label, status: item.status,
      lastVerifiedAt: item.lastVerifiedAt,
    } : item),
  }).data
}

function batchProjection(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  const progress = isRecord(value.progress) ? {
    discovered: value.progress.discovered, ready: value.progress.ready,
    reviewRequired: value.progress.reviewRequired, enriching: value.progress.enriching,
    applied: value.progress.applied,
    skipped: value.progress.skipped, failed: value.progress.failed,
  } : value.progress
  const failure = isRecord(value.failure)
    ? { code: value.failure.code, retryable: value.failure.retryable }
    : value.failure
  return placeImportBatchSchema.safeParse({
    schemaVersion: value.schemaVersion, batchId: value.batchId,
    connectionId: value.connectionId, providerKey: value.providerKey, state: value.state,
    progress, ...(failure === undefined ? {} : { failure }),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  }).data
}

function itemProjection(value: unknown): unknown {
  if (!isRecord(value)) return value
  const location = isRecord(value.location) ? {
    latitude: value.location.latitude, longitude: value.location.longitude,
  } : value.location
  return {
    schemaVersion: value.schemaVersion, itemId: value.itemId, batchId: value.batchId,
    providerKey: value.providerKey,
    ...(value.providerPlaceId === undefined ? {} : { providerPlaceId: value.providerPlaceId }),
    listName: value.listName, name: value.name, address: value.address,
    categoryLabel: value.categoryLabel, location, status: value.status,
    reviewReasons: value.reviewReasons,
    ...(value.canonicalPlaceId === undefined ? {} : { canonicalPlaceId: value.canonicalPlaceId }),
  }
}

function detailProjection(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  return placeImportBatchDetailSchema.safeParse({
    schemaVersion: value.schemaVersion,
    batch: batchProjection(value.batch),
    items: value.items.map(itemProjection),
  }).data
}

function reviewProjection(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  return placeImportReviewResultSchema.safeParse({
    schemaVersion: value.schemaVersion, commandId: value.commandId, itemId: value.itemId,
    status: value.status,
    ...(value.canonicalPlaceId === undefined ? {} : { canonicalPlaceId: value.canonicalPlaceId }),
  }).data
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('unsupported response')
  return response.json()
}

export function createBrowserImportHttp(dependencies: Dependencies) {
  const unavailable = () => problem(
    503, 'PLACE_IMPORT_WEB_UNAVAILABLE', 'Place import is temporarily unavailable',
    dependencies.createCorrelationRef(), true,
  )
  const invalid = () => problem(
    400, 'PLACE_IMPORT_REQUEST_INVALID', 'Place import request is invalid',
    dependencies.createCorrelationRef(), false,
  )

  async function session(request: Request): Promise<SessionContext | Response> {
    const auth = dependencies.resolveAuthRuntime()
    const backend = dependencies.resolveImportBackend()
    if (auth === undefined || backend === undefined) return unavailable()
    try {
      const resolved = await auth.bff.resolveSession(request)
      if (resolved === undefined) {
        return problem(
          401, 'PLACE_AUTHENTICATION_REQUIRED', 'Authentication required',
          dependencies.createCorrelationRef(), false,
        )
      }
      return { backend, accessToken: resolved.tokens.accessToken }
    } catch {
      return unavailable()
    }
  }

  async function payload(request: Request, schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }) {
    try {
      const parsed = schema.safeParse(await request.json())
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  async function result(
    response: Response,
    projection: (value: unknown) => unknown,
    acceptedStatuses: readonly number[],
  ): Promise<Response> {
    const value = await responseJson(response)
    if (response.ok && acceptedStatuses.includes(response.status)) {
      const safe = projection(value)
      if (safe === undefined) return unavailable()
      return Response.json(safe, {
        status: response.status,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      })
    }
    const safeProblem = problemSchema.safeParse(value).data
    if (safeProblem !== undefined && [400, 401, 403, 404, 409, 503].includes(response.status)) {
      return problem(
        response.status, safeProblem.code, safeProblem.title,
        safeProblem.correlationRef, safeProblem.retryable,
      )
    }
    return unavailable()
  }

  async function invoke(
    request: Request,
    operation: (context: SessionContext) => Promise<Response>,
    projection: (value: unknown) => unknown,
    acceptedStatuses: readonly number[] = [200],
  ): Promise<Response> {
    const context = await session(request)
    if (context instanceof Response) return context
    try {
      return await result(await operation(context), projection, acceptedStatuses)
    } catch {
      return unavailable()
    }
  }

  return {
    connections(request: Request): Promise<Response> {
      return invoke(request, ({ backend, accessToken }) => backend.connections(accessToken), connectionProjection)
    },
    async start(request: Request): Promise<Response> {
      const body = await payload(request, placeImportRequestSchema)
      if (body === undefined) return invalid()
      return invoke(request, ({ backend, accessToken }) => backend.start(accessToken, body), batchProjection, [200, 202])
    },
    detail(request: Request, batchId: string): Promise<Response> {
      if (!batchIdPattern.test(batchId)) return Promise.resolve(invalid())
      return invoke(request, ({ backend, accessToken }) => backend.detail(accessToken, batchId), detailProjection)
    },
    async cancel(request: Request, batchId: string): Promise<Response> {
      if (!batchIdPattern.test(batchId)) return invalid()
      const body = await payload(request, placeImportCancelRequestSchema)
      if (body === undefined) return invalid()
      return invoke(request, ({ backend, accessToken }) => backend.cancel(accessToken, batchId, body), batchProjection)
    },
    async resume(request: Request, batchId: string): Promise<Response> {
      if (!batchIdPattern.test(batchId)) return invalid()
      const body = await payload(request, placeImportResumeRequestSchema)
      if (body === undefined) return invalid()
      return invoke(request, ({ backend, accessToken }) => backend.resume(accessToken, batchId, body), batchProjection)
    },
    async review(request: Request): Promise<Response> {
      const body = await payload(request, placeImportReviewRequestSchema)
      if (body === undefined) return invalid()
      return invoke(request, ({ backend, accessToken }) => backend.review(accessToken, body), reviewProjection)
    },
  }
}

export const browserImportHttp = createBrowserImportHttp({
  resolveAuthRuntime: readNextOidcRuntime,
  resolveImportBackend: readNextImportRuntime,
  createCorrelationRef: randomUUID,
})
