import {
  catalogExplorationRequestSchema, catalogExplorationResponseSchema,
  catalogPlaceMapRequestV2Schema, catalogPlaceMapResponseV2Schema,
  catalogPlaceSearchRequestV2Schema, catalogPlaceSearchResponseV2Schema,
} from '@place/contracts/search'
import type { FastifyInstance } from 'fastify'
import { sendProductProblem } from '../../../../platform/http/product-authorization.js'
import type { SearchHttpDependencies } from './search-http-dependencies.js'
import { InvalidSearchCursorError } from '../../domain/model.js'
import { InvalidCatalogTaxonomyError } from '../../domain/catalog-home-search.js'

export function registerCatalogInteractionsHttp(application: FastifyInstance, dependencies: SearchHttpDependencies) {
  if (dependencies.explore) application.post('/v1/search/catalog/explore', async (request, reply) => {
    const parsed = catalogExplorationRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_EXPLORATION_INVALID', 'Invalid search input')
    try {
      return reply.header('cache-control', 'no-store').send(
        catalogExplorationResponseSchema.parse(await dependencies.explore!(parsed.data.query, parsed.data.near)),
      )
    } catch {
      return sendProductProblem(request, reply, 503, 'PLACE_EXPLORATION_UNAVAILABLE', 'Search suggestions are unavailable', true)
    }
  })
  if (dependencies.catalog) application.post('/v2/search/catalog', async (request, reply) => {
    const parsed = catalogPlaceSearchRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_CATALOG_SEARCH_REQUEST_INVALID', 'Invalid search input')
    try {
      const { query, intent, excludedTokenIds, limit, bounds, cursor, near, taxonomyKey } = parsed.data
      const page = await dependencies.catalog!({ query, intent, excludedTokenIds, limit,
        ...(bounds === undefined ? {} : { bounds }), ...(cursor === undefined ? {} : { cursor }),
        ...(near === undefined ? {} : { near }),
        ...(taxonomyKey === undefined ? {} : { taxonomyKey }),
      })
      return reply.header('cache-control', 'no-store').send(catalogPlaceSearchResponseV2Schema.parse({
        ...page, schemaVersion: 'catalog-place-search.v2',
      }))
    } catch (error) {
      if (error instanceof InvalidSearchCursorError) return sendProductProblem(request, reply, 400, 'PLACE_CATALOG_SEARCH_CURSOR_INVALID', 'Invalid search cursor')
      if (error instanceof InvalidCatalogTaxonomyError) return sendProductProblem(request, reply, 400, 'PLACE_CATALOG_TAXONOMY_INVALID', 'Selected taxonomy is unavailable')
      return sendProductProblem(request, reply, 503, 'PLACE_CATALOG_SEARCH_UNAVAILABLE', 'Search is unavailable', true)
    }
  })
  if (dependencies.catalogMap) application.post('/v2/search/catalog/map', async (request, reply) => {
    const parsed = catalogPlaceMapRequestV2Schema.safeParse(request.body)
    if (!parsed.success) return sendProductProblem(request, reply, 400, 'PLACE_CATALOG_MAP_REQUEST_INVALID', 'Invalid map input')
    try {
      const { taxonomyKey, ...input } = parsed.data
      const projection = await dependencies.catalogMap!({
        ...input, ...(taxonomyKey === undefined ? {} : { taxonomyKey }),
      })
      return reply.header('cache-control', 'no-store').send(catalogPlaceMapResponseV2Schema.parse({
        ...projection, schemaVersion: 'catalog-place-map.v2',
      }))
    } catch (error) {
      if (error instanceof InvalidCatalogTaxonomyError) return sendProductProblem(request, reply, 400, 'PLACE_CATALOG_TAXONOMY_INVALID', 'Selected taxonomy is unavailable')
      return sendProductProblem(request, reply, 503, 'PLACE_CATALOG_MAP_UNAVAILABLE', 'Map search is unavailable', true)
    }
  })
}
