import { afterEach, describe, expect, it } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const applications = new Set<ReturnType<typeof buildHttpApplication>>()

afterEach(async () => {
  await Promise.all([...applications].map(async (application) => application.close()))
  applications.clear()
})

describe('HTTP lifecycle scaffold', () => {
  it.each(['/healthz', '/readyz'])('reports Place availability at %s', async (route) => {
    const application = buildHttpApplication()
    applications.add(application)

    const response = await application.inject({ method: 'GET', url: route })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      schemaVersion: 'place-process-status.v1', service: 'place', state: 'ok',
    })
  })

  it('keeps liveness healthy while readiness fails closed with its dependency', async () => {
    const application = buildHttpApplication({
      readiness: async () => {
        throw new Error('database-password at internal.database.example')
      },
    })
    applications.add(application)

    const health = await application.inject({ method: 'GET', url: '/healthz' })
    const readiness = await application.inject({ method: 'GET', url: '/readyz' })

    expect(health.statusCode).toBe(200)
    expect(readiness.statusCode).toBe(503)
    expect(readiness.headers['cache-control']).toBe('no-store')
    expect(readiness.json()).toEqual({
      schemaVersion: 'place-process-status.v1',
      service: 'place',
      state: 'unavailable',
    })
    expect(readiness.body).not.toContain('database-password')
    expect(readiness.body).not.toContain('internal.database.example')
  })

  it('does not register source-only membership onboarding without dependencies', async () => {
    const application = buildHttpApplication()
    applications.add(application)

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      payload: { acceptedConsents: [] },
    })

    expect(response.statusCode).toBe(404)
  })
})
