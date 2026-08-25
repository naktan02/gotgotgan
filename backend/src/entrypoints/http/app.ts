import Fastify, { type FastifyInstance } from 'fastify'

import {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from '../../modules/access/index.js'

type HealthPayload = Readonly<{
  service: 'place'
  state: 'ok' | 'unavailable'
}>

export type HttpApplicationOptions = Readonly<{
  access?: AccessHttpDependencies
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

  return application
}
