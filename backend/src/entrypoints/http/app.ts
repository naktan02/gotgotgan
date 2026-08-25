import Fastify, { type FastifyInstance } from 'fastify'

import {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from '../../modules/access/index.js'
import { registerLibraryHttpRoutes, type LibraryHttpDependencies } from '../../modules/library/index.js'
import { registerSearchHttpRoutes, type SearchHttpDependencies } from '../../modules/search/index.js'
import { registerTaxonomyHttpRoutes, type TaxonomyHttpDependencies } from '../../modules/taxonomy/index.js'
import { registerVisitsHttpRoutes, type VisitsHttpDependencies } from '../../modules/visits/index.js'
import { registerWritingHttpRoutes, type WritingHttpDependencies } from '../../modules/writing/index.js'

type HealthPayload = Readonly<{
  service: 'place'
  state: 'ok' | 'unavailable'
}>

export type HttpApplicationOptions = Readonly<{
  access?: AccessHttpDependencies
  library?: LibraryHttpDependencies
  search?: SearchHttpDependencies
  taxonomy?: TaxonomyHttpDependencies
  visits?: VisitsHttpDependencies
  writing?: WritingHttpDependencies
  readiness?: () => Promise<boolean>
}>

export function buildHttpApplication(options: HttpApplicationOptions = {}): FastifyInstance {
  const application = Fastify({ logger: false })

  application.get('/healthz', async (): Promise<HealthPayload> => ({
    service: 'place',
    state: 'ok',
  }))

  application.get('/readyz', async (_request, reply) => {
    try {
      if (options.readiness !== undefined && !(await options.readiness())) {
        throw new Error('not ready')
      }
      const payload: HealthPayload = { service: 'place', state: 'ok' }
      return reply.status(200).send(payload)
    } catch {
      const payload: HealthPayload = { service: 'place', state: 'unavailable' }
      return reply.header('cache-control', 'no-store').status(503).send(payload)
    }
  })

  if (options.access !== undefined) registerAccessHttpRoutes(application, options.access)
  if (options.library !== undefined) registerLibraryHttpRoutes(application, options.library)
  if (options.search !== undefined) registerSearchHttpRoutes(application, options.search)
  if (options.taxonomy !== undefined) registerTaxonomyHttpRoutes(application, options.taxonomy)
  if (options.visits !== undefined) registerVisitsHttpRoutes(application, options.visits)
  if (options.writing !== undefined) registerWritingHttpRoutes(application, options.writing)

  return application
}
