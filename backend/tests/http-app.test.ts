import { afterEach, describe, expect, it } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const applications = new Set<ReturnType<typeof buildHttpApplication>>()

afterEach(async () => {
  await Promise.all([...applications].map(async (application) => application.close()))
  applications.clear()
})

describe('HTTP lifecycle scaffold', () => {
  it.each(['/healthz', '/readyz'])('reports Place readiness at %s', async (route) => {
    const application = buildHttpApplication()
    applications.add(application)

    const response = await application.inject({ method: 'GET', url: route })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ service: 'place', state: 'ok' })
  })
})
