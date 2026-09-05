import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  collectionOrderCommandRequestV2Schema,
  collectionOrderCommandResultV2Schema,
  libraryPlaceIdentifierParamsSchema,
  personalLibraryWorkspaceHttpQueryV2Schema,
  personalLibraryWorkspaceResponseV2Schema,
  personalLibraryMapHttpQueryV2Schema,
  personalLibraryMapResponseV2Schema,
  placeFilingCommandRequestV2Schema,
  placeFilingCommandResultV2Schema,
  placeFilingRequestV2Schema,
  placeFilingResponseV2Schema,
} from '@place/contracts/library'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  asOpaqueVersion,
  normalizeCollectionLifecycleCommand,
  normalizeCollectionOrderMove,
  normalizePersonalLibraryWorkspaceQuery,
  normalizePlaceFilingMutation,
} from '../../application/validate-collection-first.js'
import type {
  CollectionLifecycle,
  CollectionOrder,
  PersonalLibraryWorkspace,
  PlaceFiling,
} from '../../application/ports/collection-first.js'
import {
  InvalidCollectionFirstInputError,
  type LibraryWriteRejection,
} from '../../domain/collection-first.js'
import { InvalidLibraryCursorError, InvalidLibraryQueryError } from '../../domain/queries.js'
import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type CollectionFirstHttpDependencies = Readonly<{
  authorizer: ProductAuthorizer
  workspace: PersonalLibraryWorkspace
  filing: PlaceFiling
  order: CollectionOrder
  lifecycle: CollectionLifecycle
  now: () => Date
}>

function commandStatus(rejection: LibraryWriteRejection): 404 | 409 | 422 {
  if (rejection.code === 'not-found') return 404
  if (
    rejection.code === 'version-conflict' ||
    rejection.code === 'operation-id-reused' ||
    rejection.code === 'binding-version-conflict' ||
    rejection.code === 'publication-changed'
  ) return 409
  return 422
}

function invalid(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
) {
  return sendProductProblem(
    request, reply, 400, 'PLACE_LIBRARY_V2_REQUEST_INVALID', message,
  )
}

function unavailable(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (
    error instanceof InvalidCollectionFirstInputError ||
    error instanceof InvalidLibraryCursorError || error instanceof InvalidLibraryQueryError
  ) {
    return invalid(request, reply, 'Collection-first Library query is invalid')
  }
  return sendProductProblem(
    request, reply, 503, 'PLACE_LIBRARY_V2_UNAVAILABLE',
    'Collection-first Library is temporarily unavailable', true,
  )
}

export function registerCollectionFirstHttpRoutes(
  application: FastifyInstance,
  dependencies: CollectionFirstHttpDependencies,
): void {
  application.get('/v2/library/workspace/map', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    const parsed = personalLibraryMapHttpQueryV2Schema.safeParse(request.query)
    if (!parsed.success) return invalid(request, reply, 'Personal Library map query is invalid')
    const controller = new AbortController()
    const abort = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.once('close', abort)
    try {
      const input = parsed.data
      const projection = await dependencies.workspace.openMap({
        memberId,
        favoriteScope: input.collectionId === undefined
          ? { kind: 'all' } : { kind: 'collection', collectionId: input.collectionId },
        ratingFilter: { kind: input.rating }, tagIds: input.tagIds, tagMatch: input.tagMatch,
        areaKeys: input.areaKeys, taxonomyKeys: input.taxonomyKeys,
        ...(input.placeQuery === undefined ? {} : { placeQuery: input.placeQuery }),
        bounds: { west: input.west, south: input.south, east: input.east, north: input.north },
        zoom: input.zoom,
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]))
      if (projection === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      }
      return reply.header('cache-control', 'no-store').status(200)
        .send(personalLibraryMapResponseV2Schema.parse(projection))
    } catch (error) {
      return unavailable(request, reply, error)
    } finally {
      reply.raw.removeListener('close', abort)
    }
  })

  application.get('/v1/library/workspace', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const parsed = personalLibraryWorkspaceHttpQueryV2Schema.safeParse(request.query)
    if (!parsed.success) return invalid(request, reply, 'Personal Library query is invalid')
    try {
      const query = normalizePersonalLibraryWorkspaceQuery({
        memberId,
        ...(parsed.data.includeSelectedCollection === true ? { includeSelectedCollection: true } : {}),
        favoriteScope: parsed.data.collectionId === undefined
          ? { kind: 'all' }
          : { kind: 'collection', collectionId: parsed.data.collectionId },
        ratingFilter: { kind: parsed.data.rating },
        tagIds: parsed.data.tagIds,
        tagMatch: parsed.data.tagMatch,
        areaKeys: parsed.data.areaKeys,
        taxonomyKeys: parsed.data.taxonomyKeys,
        ...(parsed.data.collectionQuery === undefined ? {} : { collectionQuery: parsed.data.collectionQuery }),
        ...(parsed.data.placeQuery === undefined ? {} : { placeQuery: parsed.data.placeQuery }),
        ...(parsed.data.collectionCursor === undefined
          ? {}
          : { collectionCursor: parsed.data.collectionCursor }),
        ...(parsed.data.placeCursor === undefined ? {} : { placeCursor: parsed.data.placeCursor }),
        limit: parsed.data.limit,
      })
      const workspace = await dependencies.workspace.open(query)
      if (workspace === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND',
          'Library resource not found',
        )
      }
      const response = personalLibraryWorkspaceResponseV2Schema.parse({
        schemaVersion: workspace.schemaVersion,
        ...(workspace.selectedCollection === undefined ? {} : {
          selectedCollection: {
            collectionId: workspace.selectedCollection.collectionId,
            name: workspace.selectedCollection.name,
            description: workspace.selectedCollection.description,
            visibility: workspace.selectedCollection.visibility,
            publicationId: workspace.selectedCollection.publicationId,
            placeCount: workspace.selectedCollection.placeCount,
            collectionRevision: workspace.selectedCollection.version,
            updatedAt: workspace.selectedCollection.updatedAt,
          },
        }),
        filter: workspace.filter,
        collections: workspace.collections.items.map((collection) => ({
          collectionId: collection.collectionId,
          name: collection.name,
          description: collection.description,
          visibility: collection.visibility,
          publicationId: collection.publicationId,
          placeCount: collection.placeCount,
          collectionRevision: collection.version,
          updatedAt: collection.updatedAt,
        })),
        ...(workspace.collections.nextCursor === undefined
          ? {}
          : { collectionNextCursor: workspace.collections.nextCursor }),
        places: workspace.favoritePlaces.items.map((place) => ({
          placeId: place.placeId,
          overlay: {
            isFavorited: place.collectionMembershipCount > 0,
            collectionCount: place.collectionMembershipCount,
            personalRating: place.personalRating,
          },
          place: place.place,
        })),
        ...(workspace.favoritePlaces.nextCursor === undefined
          ? {}
          : { placeNextCursor: workspace.favoritePlaces.nextCursor }),
        availableFilters: workspace.availableFilters,
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.get('/v1/library/places/:placeId/filing', async (request, reply) => {
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.read',
    )
    if (memberId === undefined) return
    const params = libraryPlaceIdentifierParamsSchema.safeParse(request.params)
    const query = placeFilingRequestV2Schema.safeParse(request.query)
    if (!params.success || !query.success) {
      return invalid(request, reply, 'Place filing query is invalid')
    }
    try {
      const filing = await dependencies.filing.open({
        memberId,
        placeId: params.data.placeId,
        ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
        limit: query.data.limit,
      })
      if (filing === undefined) {
        return sendProductProblem(
          request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND',
          'Library resource not found',
        )
      }
      const response = placeFilingResponseV2Schema.parse({
        schemaVersion: filing.schemaVersion,
        placeId: filing.placeId,
        overlay: {
          isFavorited: filing.collectionMembershipCount > 0,
          collectionCount: filing.collectionMembershipCount,
          personalRating: filing.personalRating,
        },
        collections: filing.collections.map((collection) => ({
          collectionId: collection.collectionId,
          name: collection.name,
          included: collection.included,
          collectionRevision: collection.version,
        })),
        ...(filing.nextCursor === undefined ? {} : { nextCursor: filing.nextCursor }),
      })
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v1/library/filing-commands', async (request, reply) => {
    const parsed = placeFilingCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Place filing command is invalid')
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.write',
    )
    if (memberId === undefined) return
    try {
      const result = await dependencies.filing.apply(normalizePlaceFilingMutation({
        context: {
          operationId: parsed.data.commandId,
          memberId,
          occurredAt: dependencies.now().toISOString(),
        },
        placeId: parsed.data.placeId,
        changes: parsed.data.changes.map((change) => ({
          collectionId: change.collectionId,
          expectedVersion: asOpaqueVersion(change.expectedCollectionRevision),
          desired: change.desired,
        })),
      }))
      const response = result.status === 'rejected'
        ? placeFilingCommandResultV2Schema.parse({
            schemaVersion: 'place-filing-command-result.v2',
            outcome: 'rejected',
            commandId: parsed.data.commandId,
            rejection: result.rejection,
          })
        : placeFilingCommandResultV2Schema.parse({
            schemaVersion: 'place-filing-command-result.v2',
            outcome: 'accepted',
            receipt: { commandId: parsed.data.commandId, status: result.status },
            placeId: result.value.placeId,
            overlay: {
              isFavorited: result.value.collectionMembershipCount > 0,
              collectionCount: result.value.collectionMembershipCount,
              personalRating: result.value.personalRating,
            },
            collections: result.value.collections.map((collection) => ({
              collectionId: collection.collectionId,
              included: collection.included,
              collectionRevision: collection.version,
            })),
          })
      const status = result.status === 'rejected'
        ? commandStatus(result.rejection)
        : result.status === 'applied' ? 201 : 200
      return reply.header('cache-control', 'no-store').status(status).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v1/library/order-commands', async (request, reply) => {
    const parsed = collectionOrderCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Collection order command is invalid')
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, 'library.write',
    )
    if (memberId === undefined) return
    try {
      const result = await dependencies.order.move(normalizeCollectionOrderMove({
        context: {
          operationId: parsed.data.commandId,
          memberId,
          occurredAt: dependencies.now().toISOString(),
        },
        collectionId: parsed.data.collectionId,
        placeId: parsed.data.placeId,
        expectedVersion: asOpaqueVersion(parsed.data.expectedCollectionRevision),
        placement: parsed.data.anchor,
      }))
      const response = result.status === 'rejected'
        ? collectionOrderCommandResultV2Schema.parse({
            schemaVersion: 'collection-order-command-result.v2', outcome: 'rejected',
            commandId: parsed.data.commandId, rejection: result.rejection,
          })
        : collectionOrderCommandResultV2Schema.parse({
            schemaVersion: 'collection-order-command-result.v2', outcome: 'accepted',
            receipt: { commandId: parsed.data.commandId, status: result.status },
            collectionId: result.value.collectionId,
            placeId: result.value.placeId,
            collectionRevision: result.value.version,
          })
      const status = result.status === 'rejected'
        ? commandStatus(result.rejection)
        : result.status === 'applied' ? 201 : 200
      return reply.header('cache-control', 'no-store').status(status).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })

  application.post('/v1/library/collection-commands', async (request, reply) => {
    const parsed = collectionLifecycleCommandRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return invalid(request, reply, 'Collection lifecycle command is invalid')
    const permission = parsed.data.kind === 'update' && parsed.data.visibility !== undefined
      ? 'library.share'
      : 'library.write'
    const memberId = await requireProductMember(
      request, reply, dependencies.authorizer, permission,
    )
    if (memberId === undefined) return
    try {
      const context = {
        operationId: parsed.data.commandId,
        memberId,
        occurredAt: dependencies.now().toISOString(),
      }
      const command = parsed.data.kind === 'create'
        ? normalizeCollectionLifecycleCommand({
            kind: 'create', context,
            collectionId: parsed.data.collectionId,
            name: parsed.data.name,
            description: parsed.data.description,
          })
        : parsed.data.kind === 'delete'
          ? normalizeCollectionLifecycleCommand({
              kind: 'delete', context,
              collectionId: parsed.data.collectionId,
              expectedVersion: asOpaqueVersion(parsed.data.expectedCollectionRevision),
            })
          : normalizeCollectionLifecycleCommand({
              kind: 'update', context,
              collectionId: parsed.data.collectionId,
              expectedVersion: asOpaqueVersion(parsed.data.expectedCollectionRevision),
              ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
              ...(parsed.data.description === undefined
                ? {}
                : { description: parsed.data.description }),
              ...(parsed.data.visibility === undefined
                ? {}
                : { visibility: parsed.data.visibility }),
            })
      const result = await dependencies.lifecycle.apply(command)
      const response = result.status === 'rejected'
        ? collectionLifecycleCommandResultV2Schema.parse({
            schemaVersion: 'collection-lifecycle-command-result.v2', outcome: 'rejected',
            commandId: parsed.data.commandId, rejection: result.rejection,
          })
        : collectionLifecycleCommandResultV2Schema.parse({
            schemaVersion: 'collection-lifecycle-command-result.v2', outcome: 'accepted',
            receipt: { commandId: parsed.data.commandId, status: result.status },
            collection: result.value.collection === null ? null : {
              collectionId: result.value.collection.collectionId,
              name: result.value.collection.name,
              description: result.value.collection.description,
              visibility: result.value.collection.visibility,
              publicationId: result.value.collection.publicationId,
              placeCount: result.value.collection.placeCount,
              collectionRevision: result.value.collection.version,
              updatedAt: result.value.collection.updatedAt,
            },
          })
      const status = result.status === 'rejected'
        ? commandStatus(result.rejection)
        : result.status === 'applied' ? 201 : 200
      return reply.header('cache-control', 'no-store').status(status).send(response)
    } catch (error) {
      return unavailable(request, reply, error)
    }
  })
}
