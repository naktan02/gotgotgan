import { describe, expect, it } from 'vitest'

import { createBrowserProcessReadiness } from './browser-process-readiness'

describe('browser process readiness', () => {
  it('is ready when optional source-only integrations remain disabled', async () => {
    const readiness = createBrowserProcessReadiness({
      environment: {},
      resolveOidcRuntime: () => undefined,
      resolveMembershipBackend: () => undefined,
    })

    const response = await readiness.check()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ service: 'place-web', state: 'ok' })
  })

  it('checks every explicitly activated dependency and fails closed safely', async () => {
    const observed: string[] = []
    const ready = createBrowserProcessReadiness({
      environment: {
        PLACE_OIDC_RUNTIME_ENABLED: 'true',
        PLACE_MEMBERSHIP_RUNTIME_ENABLED: 'true',
      },
      resolveOidcRuntime: () => ({
        ready: async () => void observed.push('oidc'),
      }),
      resolveMembershipBackend: () => ({
        ready: async () => {
          observed.push('membership')
          return new Response(null, { status: 200 })
        },
      }),
    })

    expect((await ready.check()).status).toBe(200)
    expect(observed.sort()).toEqual(['membership', 'oidc'])

    const unavailable = createBrowserProcessReadiness({
      environment: { PLACE_MEMBERSHIP_RUNTIME_ENABLED: 'true' },
      resolveOidcRuntime: () => undefined,
      resolveMembershipBackend: () => ({
        ready: async () => {
          throw new Error('backend-secret at internal.backend.example')
        },
      }),
    })
    const response = await unavailable.check()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(JSON.parse(body)).toEqual({
      service: 'place-web',
      state: 'unavailable',
    })
    expect(body).not.toContain('backend-secret')
    expect(body).not.toContain('internal.backend.example')
  })

  it('fails closed when an activated runtime has not been installed', async () => {
    const readiness = createBrowserProcessReadiness({
      environment: { PLACE_OIDC_RUNTIME_ENABLED: 'true' },
      resolveOidcRuntime: () => undefined,
      resolveMembershipBackend: () => undefined,
    })

    expect((await readiness.check()).status).toBe(503)
  })
})
