import {
  providerPlaceDetailRequestSchema,
  providerPlaceDetailSchema,
} from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'

import {
  ProviderDetailUnsupportedError,
  type ProviderPlaceDetail,
  type ProviderPlaceDetailRequest,
  type ProviderKey,
} from '../../domain/model.js'
import { sendProductProblem } from '../../../../platform/http/product-authorization.js'

export type ProviderHttpDependencies = Readonly<{
  getDetail: (request: ProviderPlaceDetailRequest) => Promise<ProviderPlaceDetail>
  supportedProviders: readonly ProviderKey[]
}>

export function registerProviderHttpRoutes(
  application: FastifyInstance,
  dependencies: ProviderHttpDependencies,
): void {
  application.post('/v1/providers/place-details', async (request, reply) => {
    const parsed = providerPlaceDetailRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_PROVIDER_DETAIL_REQUEST_INVALID',
        'Provider place detail request is invalid',
      )
    }
    if (!dependencies.supportedProviders.includes(parsed.data.providerKey)) {
      return sendProductProblem(
        request, reply, 400, 'PLACE_PROVIDER_DETAIL_UNSUPPORTED',
        'Provider place details are unsupported',
      )
    }
    try {
      const detail = providerPlaceDetailSchema.parse(await dependencies.getDetail({
        providerKey: parsed.data.providerKey,
        providerPlaceId: parsed.data.providerPlaceId,
      }))
      return reply.header('cache-control', 'no-store').status(200).send(detail)
    } catch (error) {
      if (error instanceof ProviderDetailUnsupportedError) {
        return sendProductProblem(
          request, reply, 400, 'PLACE_PROVIDER_DETAIL_UNSUPPORTED',
          'Provider place details are unsupported',
        )
      }
      return sendProductProblem(
        request, reply, 503, 'PLACE_PROVIDER_DETAIL_UNAVAILABLE',
        'Provider place details are temporarily unavailable', true,
      )
    }
  })
}
