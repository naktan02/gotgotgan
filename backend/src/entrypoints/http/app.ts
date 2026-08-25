import Fastify, { type FastifyInstance } from 'fastify'

import {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from '../../modules/access/index.js'

type HealthPayload = Readonly<{
  service: 'place'
  state: 'ok'
}>

export type HttpApplicationOptions = Readonly<{
  access?: AccessHttpDependencies
}>

export function buildHttpApplication(options: HttpApplicationOptions = {}): FastifyInstance {
  const application = Fastify({ logger: false })

  application.get('/healthz', async (): Promise<HealthPayload> => ({
    service: 'place',
    state: 'ok',
  }))

  application.get('/readyz', async (): Promise<HealthPayload> => ({
    service: 'place',
    state: 'ok',
  }))

  if (options.access !== undefined) registerAccessHttpRoutes(application, options.access)

  return application
}
