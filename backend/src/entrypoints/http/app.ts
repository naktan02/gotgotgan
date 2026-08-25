import Fastify, { type FastifyInstance } from 'fastify'

type HealthPayload = Readonly<{
  service: 'place'
  state: 'ok'
}>

export function buildHttpApplication(): FastifyInstance {
  const application = Fastify({ logger: false })

  application.get('/healthz', async (): Promise<HealthPayload> => ({
    service: 'place',
    state: 'ok',
  }))

  application.get('/readyz', async (): Promise<HealthPayload> => ({
    service: 'place',
    state: 'ok',
  }))

  return application
}
