import type { FastifyInstance } from 'fastify'
import {
  personalLibraryMapHttpQueryV4Schema,
  personalLibraryMapResponseV4Schema,
} from '@place/contracts/library'

import {
  requireProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'
import type { PersonalLibraryMapV4 } from '../../application/ports/personal-library-map-v4.js'
import { InvalidLibraryQueryError } from '../../domain/queries.js'

export function registerLibraryMapV4HttpRoutes(application: FastifyInstance, dependencies: Readonly<{
  authorizer: ProductAuthorizer
  map: PersonalLibraryMapV4
}>): void {
  application.get('/v4/library/workspace/map', async (request, reply) => {
    const memberId = await requireProductMember(request, reply, dependencies.authorizer, 'library.read')
    if (memberId === undefined) return
    const parsed = personalLibraryMapHttpQueryV4Schema.safeParse(request.query)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 400, 'PLACE_LIBRARY_MAP_QUERY_INVALID', 'Library map query is invalid')
    }
    const controller = new AbortController()
    const abort = () => { if (!reply.raw.writableFinished) controller.abort() }
    reply.raw.once('close', abort)
    try {
      const input = parsed.data
      const result = await dependencies.map.openMapV4({
        memberId,
        selection: input.scope === 'all'
          ? { kind: 'all' }
          : { kind: 'collections', collectionIds: input.collectionIds },
        ...(input.placeQuery === undefined ? {} : { placeQuery: input.placeQuery }),
        ratingFilter: { kind: input.rating },
        tagIds: input.tagIds,
        tagMatch: input.tagMatch,
        areaKeys: input.areaKeys,
        taxonomyKeys: input.taxonomyKeys,
        ...(input.selectedPlaceId === undefined ? {} : { selectedPlaceId: input.selectedPlaceId }),
        bounds: { west: input.west, south: input.south, east: input.east, north: input.north },
        zoom: input.zoom,
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]))
      if (result === undefined) {
        return sendProductProblem(request, reply, 404, 'PLACE_LIBRARY_RESOURCE_NOT_FOUND', 'Library resource not found')
      }
      return reply.header('cache-control', 'no-store').send(personalLibraryMapResponseV4Schema.parse(result))
    } catch (error) {
      const invalid = error instanceof InvalidLibraryQueryError
      return sendProductProblem(
        request,
        reply,
        invalid ? 400 : 503,
        invalid ? 'PLACE_LIBRARY_MAP_QUERY_INVALID' : 'PLACE_LIBRARY_MAP_UNAVAILABLE',
        invalid ? 'Library map query is invalid' : 'Library map is temporarily unavailable',
        !invalid,
      )
    } finally {
      reply.raw.removeListener('close', abort)
    }
  })
}
