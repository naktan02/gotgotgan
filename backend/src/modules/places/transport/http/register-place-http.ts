import { placeIdentifierParamsSchema } from '@place/contracts/http'
import { placeDetailResponseSchema } from '@place/contracts/places'
import type { FastifyInstance } from 'fastify'

import type { PlaceDetailReader } from '../../application/read-place-detail.js'
import {
  resolveOptionalProductMember,
  sendProductProblem,
  type ProductAuthorizer,
} from '../../../../platform/http/product-authorization.js'

export type PlaceHttpDependencies = Readonly<{
  read: PlaceDetailReader
  authorizer?: ProductAuthorizer
}>

export function registerPlaceHttpRoutes(
  application: FastifyInstance,
  dependencies: PlaceHttpDependencies,
): void {
  application.get('/v1/places/:placeId', async (request, reply) => {
    const parsed = placeIdentifierParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return sendProductProblem(request, reply, 404, 'PLACE_NOT_FOUND', 'Place not found')
    }

    const viewer = await resolveOptionalProductMember(
      request,
      reply,
      dependencies.authorizer,
      'library.read',
    )
    if (viewer.kind === 'replied') return

    try {
      const result = await dependencies.read({
        requestedPlaceId: parsed.data.placeId,
        ...(viewer.kind === 'member' ? { memberId: viewer.memberId } : {}),
      })
      if (result.status === 'not-found') {
        return sendProductProblem(request, reply, 404, 'PLACE_NOT_FOUND', 'Place not found')
      }
      if (result.status === 'retired') {
        return sendProductProblem(request, reply, 410, 'PLACE_RETIRED', 'Place is retired')
      }
      if (result.status === 'unavailable') {
        return sendProductProblem(
          request,
          reply,
          503,
          'PLACE_DETAIL_UNAVAILABLE',
          'Place detail is temporarily unavailable',
          true,
        )
      }
      const response = placeDetailResponseSchema.parse(result.detail)
      return reply.header('cache-control', 'no-store').status(200).send(response)
    } catch {
      return sendProductProblem(
        request,
        reply,
        503,
        'PLACE_DETAIL_UNAVAILABLE',
        'Place detail is temporarily unavailable',
        true,
      )
    }
  })
}
