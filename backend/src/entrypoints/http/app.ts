import Fastify, { type FastifyInstance } from 'fastify'
import { processStatusSchema, type ProcessStatus } from '@place/contracts/http'

import {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from '../../modules/access/index.js'
import { registerLibraryHttpRoutes, type LibraryHttpDependencies } from '../../modules/library/index.js'
import {
  registerConnectorHttpRoutes,
  registerImportHttpRoutes,
  type ConnectorHttpDependencies,
  type ImportHttpDependencies,
} from '../../modules/ingestion/index.js'
import { registerProviderHttpRoutes, type ProviderHttpDependencies } from '../../modules/providers/index.js'
import { registerPlaceHttpRoutes, type PlaceHttpDependencies } from '../../modules/places/index.js'
import { registerProfileHttpRoutes, type ProfileHttpDependencies } from '../../modules/profiles/index.js'
import { registerSearchHttpRoutes, type SearchHttpDependencies } from '../../modules/search/index.js'
import { registerTaxonomyHttpRoutes, type TaxonomyHttpDependencies } from '../../modules/taxonomy/index.js'
import {
  registerProviderTransferHttpRoutes,
  type ProviderTransferHttpDependencies,
} from '../../modules/transfers/index.js'
import { registerVisitsHttpRoutes, type VisitsHttpDependencies } from '../../modules/visits/index.js'
import { registerWritingHttpRoutes, type WritingHttpDependencies } from '../../modules/writing/index.js'

export type HttpApplicationOptions = Readonly<{
  access?: AccessHttpDependencies
  connector?: ConnectorHttpDependencies
  library?: LibraryHttpDependencies
  imports?: ImportHttpDependencies
  providers?: ProviderHttpDependencies
  places?: PlaceHttpDependencies
  profiles?: ProfileHttpDependencies
  search?: SearchHttpDependencies
  taxonomy?: TaxonomyHttpDependencies
  transfers?: ProviderTransferHttpDependencies
  visits?: VisitsHttpDependencies
  writing?: WritingHttpDependencies
  readiness?: () => Promise<boolean>
}>

export function buildHttpApplication(options: HttpApplicationOptions = {}): FastifyInstance {
  const application = Fastify({ logger: false })

  application.get('/healthz', async (): Promise<ProcessStatus> => processStatusSchema.parse({
    schemaVersion: 'place-process-status.v1', service: 'place', state: 'ok',
  }))

  application.get('/readyz', async (_request, reply) => {
    try {
      if (options.readiness !== undefined && !(await options.readiness())) {
        throw new Error('not ready')
      }
      const payload = processStatusSchema.parse({
        schemaVersion: 'place-process-status.v1', service: 'place', state: 'ok',
      })
      return reply.status(200).send(payload)
    } catch {
      const payload = processStatusSchema.parse({
        schemaVersion: 'place-process-status.v1', service: 'place', state: 'unavailable',
      })
      return reply.header('cache-control', 'no-store').status(503).send(payload)
    }
  })

  if (options.access !== undefined) registerAccessHttpRoutes(application, options.access)
  if (options.connector !== undefined) registerConnectorHttpRoutes(application, options.connector)
  if (options.library !== undefined) registerLibraryHttpRoutes(application, options.library)
  if (options.imports !== undefined) registerImportHttpRoutes(application, options.imports)
  if (options.providers !== undefined) registerProviderHttpRoutes(application, options.providers)
  if (options.places !== undefined) registerPlaceHttpRoutes(application, options.places)
  if (options.profiles !== undefined) registerProfileHttpRoutes(application, options.profiles)
  if (options.search !== undefined) registerSearchHttpRoutes(application, options.search)
  if (options.taxonomy !== undefined) registerTaxonomyHttpRoutes(application, options.taxonomy)
  if (options.transfers !== undefined) registerProviderTransferHttpRoutes(application, options.transfers)
  if (options.visits !== undefined) registerVisitsHttpRoutes(application, options.visits)
  if (options.writing !== undefined) registerWritingHttpRoutes(application, options.writing)

  return application
}
