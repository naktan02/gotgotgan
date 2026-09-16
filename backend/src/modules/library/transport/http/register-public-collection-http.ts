import {
  discoverableCollectionParamsV2Schema,
  discoverableCollectionQueryV2Schema,
  discoverableCollectionResponseV2Schema,
  publicCollectionDirectoryQueryV2Schema,
  publicCollectionDirectoryResponseV2Schema,
  publishedCollectionCopyCommandRequestV2Schema,
  publishedCollectionCopyCommandResultV2Schema,
} from '@place/contracts/library'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { asOpaqueVersion, normalizePublishedCollectionCopy } from '../../application/validate-collection-first.js'
import type { PublishedCollectionExchange } from '../../application/ports/collection-first.js'
import type { PublicCollectionDiscovery } from '../../application/ports/public-collection-discovery.js'
import { InvalidCollectionFirstInputError, type LibraryWriteRejection } from '../../domain/collection-first.js'
import { InvalidLibraryCursorError, InvalidLibraryQueryError } from '../../domain/queries.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type PublicCollectionHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  discovery: PublicCollectionDiscovery
  exchange: PublishedCollectionExchange
  now: () => Date
}>

function commandStatus(rejection: LibraryWriteRejection): 404 | 409 | 422 {
  if (rejection.code === 'not-found') return 404
  if (
    rejection.code === 'publication-changed' || rejection.code === 'version-conflict' ||
    rejection.code === 'operation-id-reused'
  ) return 409
  return 422
}

function invalid(request: FastifyRequest, reply: FastifyReply, message: string) {
  return sendProductProblem(request, reply, 400, 'PLACE_PUBLIC_COLLECTION_REQUEST_INVALID', message)
}

function unavailable(request: FastifyRequest, reply: FastifyReply) {
  return sendProductProblem(
    request, reply, 503, 'PLACE_PUBLIC_COLLECTION_UNAVAILABLE',
    'Public Collections are temporarily unavailable', true,
  )
}

export function registerPublicCollectionHttpRoutes(
  application: FastifyInstance,
  dependencies: PublicCollectionHttpDependencies,
): void {
  application.get('/v1/public/collection-directory', async (request, reply) => {
    const parsed = publicCollectionDirectoryQueryV2Schema.safeParse(request.query)
    if (!parsed.success) return invalid(request, reply, 'Public Collection directory query is invalid')
    try {
      const page = await dependencies.discovery.list({
        q: parsed.data.q ?? null,
        areaKeys: parsed.data.areaKeys,
        taxonomyKeys: parsed.data.taxonomyKeys,
        topicKeys: parsed.data.topicKeys,
        sort: parsed.data.sort,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        limit: parsed.data.limit,
      })
      return reply.header('cache-control', 'public, max-age=30').status(200).send(
        publicCollectionDirectoryResponseV2Schema.parse({
          schemaVersion: 'public-collection-directory.v2',
          filter: page.filter,
          items: page.items.map((item) => ({
            publicationId: item.publicationId,
            publicationVersion: item.publicationVersion,
            name: item.name,
            description: item.description,
            placeCount: item.placeCount,
            updatedAt: item.updatedAt,
            owner: item.owner,
            topics: item.topics,
            previewPlaces: item.previewPlaces,
          })),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          availableFilters: page.availableFilters,
        }),
      )
    } catch (error) {
      if (error instanceof InvalidLibraryCursorError || error instanceof InvalidLibraryQueryError) {
        return invalid(request, reply, 'Public Collection directory query is invalid')
      }
      return unavailable(request, reply)
    }
  })

  application.get('/v1/public/discoverable-collections/:publicationId', async (request, reply) => {
    const params = discoverableCollectionParamsV2Schema.safeParse(request.params)
    const query = discoverableCollectionQueryV2Schema.safeParse(request.query)
    if (!params.success || !query.success) {
      return invalid(request, reply, 'Discoverable Collection query is invalid')
    }
    try {
      const collection = await dependencies.discovery.get({
        publicationId: params.data.publicationId,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        limit: query.data.limit,
      })
      if (collection === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_PUBLIC_COLLECTION_NOT_FOUND', 'Public Collection not found',
        )
      }
      return reply.header('cache-control', 'public, max-age=30').status(200).send(
        discoverableCollectionResponseV2Schema.parse({
          schemaVersion: 'discoverable-collection.v2',
          ...collection,
        }),
      )
    } catch (error) {
      if (error instanceof InvalidLibraryCursorError || error instanceof InvalidLibraryQueryError) {
        return invalid(request, reply, 'Discoverable Collection query is invalid')
      }
      return unavailable(request, reply)
    }
  })

  application.post('/v1/library/publication-copy-commands', async (request, reply) => {
    const parsed = publishedCollectionCopyCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Published Collection copy command is invalid')
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.write',
    )
    if (memberId === undefined) return
    try {
      const result = await dependencies.exchange.copy(normalizePublishedCollectionCopy({
        context: {
          operationId: parsed.data.commandId,
          memberId,
          occurredAt: dependencies.now().toISOString(),
        },
        publicationId: parsed.data.sourcePublicationId,
        expectedPublicationVersion: asOpaqueVersion(parsed.data.expectedPublicationVersion),
        targetCollectionId: parsed.data.target.collectionId,
        targetName: parsed.data.target.name,
        selection: parsed.data.selection,
      }))
      const response = result.status === 'rejected'
        ? publishedCollectionCopyCommandResultV2Schema.parse({
            schemaVersion: 'published-collection-copy-command-result.v2',
            outcome: 'rejected', commandId: parsed.data.commandId, rejection: result.rejection,
          })
        : publishedCollectionCopyCommandResultV2Schema.parse({
            schemaVersion: 'published-collection-copy-command-result.v2',
            outcome: 'accepted',
            receipt: { commandId: parsed.data.commandId, status: result.status },
            collectionId: result.value.collectionId,
            collectionRevision: result.value.version,
            copiedPlaceCount: result.value.copiedPlaceCount,
          })
      const status = result.status === 'rejected'
        ? commandStatus(result.rejection)
        : result.status === 'applied' ? 201 : 200
      return reply.header('cache-control', 'no-store').status(status).send(response)
    } catch (error) {
      if (error instanceof InvalidCollectionFirstInputError) {
        return invalid(request, reply, 'Published Collection copy command is invalid')
      }
      return unavailable(request, reply)
    }
  })
}
