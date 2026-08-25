import { taxonomyProjectionSchema } from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'

import { listCurrentTaxonomy } from '../../application/taxonomy.js'
import type { TaxonomyStore } from '../../application/ports/taxonomy-store.js'
import { sendProductProblem } from '../../../../platform/http/product-authorization.js'

export type TaxonomyHttpDependencies = Readonly<{ store: TaxonomyStore }>

export function registerTaxonomyHttpRoutes(
  application: FastifyInstance,
  dependencies: TaxonomyHttpDependencies,
): void {
  application.get('/v1/taxonomy/nodes', async (request, reply) => {
    try {
      const projection = taxonomyProjectionSchema.parse(
        await listCurrentTaxonomy(dependencies.store),
      )
      return reply.header('cache-control', 'public, max-age=300').status(200).send(projection)
    } catch {
      return sendProductProblem(request, reply, 503, 'PLACE_TAXONOMY_UNAVAILABLE', 'Taxonomy is temporarily unavailable', true)
    }
  })
}
