import type { FastifyInstance } from 'fastify'
import {
  placeImportCancelRequestSchema,
  placeImportBatchIdentifierParamsSchema,
  placeImportRequestSchema,
  placeImportReviewRequestSchema,
  placeImportResumeRequestSchema,
} from '@place/contracts/imports'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import { requestPlaceImport } from '../../application/request-place-import.js'
import { reviewImportItem } from '../../application/review-import-item.js'
import type { CanonicalPlaceMaterializationPort } from '../../application/ports/canonical-place-materialization.js'
import type { ImportManagementStore } from '../../application/ports/import-management-store.js'
import type { ImportQueries } from '../../application/import-queries.js'
import type { ImportRequestStore } from '../../application/ports/import-request-store.js'
import type { ImportReviewStore } from '../../application/ports/import-review-store.js'
import type { ImportedPlaceLibraryPort } from '../../application/ports/imported-place-library.js'
import type { IngestionStore } from '../../application/ports/ingestion-store.js'
import type { ProviderConnectionStore } from '../../application/ports/provider-connection-store.js'
import {
  ImportRequestConflictError,
  ImportReferenceUnavailableError,
  ProviderConnectionUnavailableError,
} from '../../domain/imports.js'
import { importBatchProjection } from './import-http-projections.js'
import { registerImportQueryHttpRoutes } from './register-import-query-http.js'

export type ImportHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  requestStore: ImportRequestStore
  managementStore: ImportManagementStore
  queries: ImportQueries
  connectionStore: ProviderConnectionStore
  nextBatchId: () => string
  nextJobId: () => string
  now: () => Date
  review?: Readonly<{
    store: ImportReviewStore
    ingestionStore: IngestionStore
    canonical: CanonicalPlaceMaterializationPort
    library: ImportedPlaceLibraryPort
  }>
}>

function batchId(requestParams: unknown): string | undefined {
  const parsed = placeImportBatchIdentifierParamsSchema.safeParse(requestParams)
  return parsed.success ? parsed.data.batchId : undefined
}

export function registerImportHttpRoutes(
  application: FastifyInstance,
  dependencies: ImportHttpDependencies,
): void {
  registerImportQueryHttpRoutes(application, {
    authorizer: dependencies.authorizer,
    queries: dependencies.queries,
  })
  application.get('/v1/provider-connections', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.read',
    )
    if (memberId === undefined) return
    const connections = await dependencies.connectionStore.listConnections(memberId)
    return reply.header('cache-control', 'no-store').status(200).send({
      schemaVersion: 'place-provider-connections.v1',
      items: connections.map((connection) => ({
        schemaVersion: 'place-provider-connection.v1',
        ...connection,
      })),
    })
  })

  application.post('/v1/imports', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    const parsed = placeImportRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_REQUEST_INVALID', 'Import request is invalid',
      )
    }
    try {
      const result = await requestPlaceImport({
        memberId,
        connectionId: parsed.data.connectionId,
        idempotencyKey: parsed.data.idempotencyKey,
        nextBatchId: dependencies.nextBatchId,
        nextJobId: dependencies.nextJobId,
        now: dependencies.now,
        store: dependencies.requestStore,
      })
      return reply
        .header('cache-control', 'no-store')
        .status(result.status === 'created' ? 202 : 200)
        .send(importBatchProjection(result.batch))
    } catch (error) {
      if (error instanceof ProviderConnectionUnavailableError) {
        return sendProductProblem(
          request, reply, 409, 'PLACE_PROVIDER_CONNECTION_UNAVAILABLE',
          'Provider connection is unavailable', true,
        )
      }
      if (error instanceof ImportRequestConflictError) {
        return sendProductProblem(
          request, reply, 409, 'PLACE_IMPORT_REQUEST_CONFLICT',
          'Import request conflicts with an earlier request',
        )
      }
      throw error
    }
  })

  application.post('/v1/imports/:batchId/cancel', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    const id = batchId(request.params)
    const body = placeImportCancelRequestSchema.safeParse(request.body)
    if (id === undefined || !body.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_CANCEL_INVALID', 'Import cancellation is invalid',
      )
    }
    const result = await dependencies.managementStore.cancelImport(
      memberId, id, dependencies.now().toISOString(),
    )
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_IMPORT_NOT_FOUND', 'Import was not found')
      : reply.header('cache-control', 'no-store').status(200).send(importBatchProjection(result))
  })

  application.post('/v1/imports/:batchId/resume', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'imports.write',
    )
    if (memberId === undefined) return
    const id = batchId(request.params)
    const body = placeImportResumeRequestSchema.safeParse(request.body)
    if (id === undefined || !body.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_IMPORT_RESUME_INVALID', 'Import resume request is invalid',
      )
    }
    const result = await dependencies.managementStore.resumeImport(
      memberId, id, dependencies.now().toISOString(),
    )
    return result === undefined
      ? sendProductProblem(request, reply, 404, 'PLACE_IMPORT_NOT_FOUND', 'Import was not found')
      : reply.header('cache-control', 'no-store').status(200).send(importBatchProjection(result))
  })

  const review = dependencies.review
  if (review !== undefined) {
    application.post('/v1/import-reviews', async (request, reply) => {
      const memberId = await requireProductMember(
        request, reply, dependencies.authorizer, 'imports.write',
      )
      if (memberId === undefined) return
      const parsed = placeImportReviewRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return sendProductProblem(
          request, reply, 400, 'PLACE_IMPORT_REVIEW_INVALID', 'Import review is invalid',
        )
      }
      try {
        const result = await reviewImportItem({
          memberId,
          commandId: parsed.data.commandId,
          itemId: parsed.data.itemId,
          action: parsed.data.action.kind === 'skip'
            ? {
                kind: 'skip',
                ...(parsed.data.action.reason === undefined
                  ? {}
                  : { reason: parsed.data.action.reason }),
              }
            : parsed.data.action,
          occurredAt: dependencies.now().toISOString(),
          reviewStore: review.store,
          ingestionStore: review.ingestionStore,
          canonical: review.canonical,
          library: review.library,
        })
        return reply.header('cache-control', 'no-store').status(200).send({
          schemaVersion: 'place-import-review-result.v1',
          ...result,
        })
      } catch (error) {
        if (error instanceof ImportRequestConflictError) {
          return sendProductProblem(
            request, reply, 409, 'PLACE_IMPORT_REVIEW_CONFLICT',
            'Import review conflicts with an earlier action',
          )
        }
        if (error instanceof ImportReferenceUnavailableError) {
          return sendProductProblem(
            request, reply, 404, 'PLACE_IMPORT_ITEM_UNAVAILABLE',
            'Import item is unavailable',
          )
        }
        throw error
      }
    })
  }
}
