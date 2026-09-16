import { describe, expect, it, vi } from 'vitest'

import { createAdminProcessReadiness } from './admin-process-readiness'

describe('administrator process readiness', () => {
  it('is unavailable until the admin OIDC runtime is installed', async () => {
    const readiness = createAdminProcessReadiness({
      resolveAuthRuntime: () => undefined,
      createBackendClient: () => { throw new Error('must not run') },
    })
    expect((await readiness.check()).status).toBe(503)
  })

  it('requires both OIDC and Backend readiness', async () => {
    const readiness = createAdminProcessReadiness({
      resolveAuthRuntime: () => ({ ready: vi.fn().mockResolvedValue(undefined) }),
      createBackendClient: () => ({
        ready: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
      }),
    })
    const response = await readiness.check()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      schemaVersion: 'place-process-status.v1',
      service: 'place-admin-web',
      state: 'ok',
    })
  })

  it('does not report ready when Backend is unavailable', async () => {
    const readiness = createAdminProcessReadiness({
      resolveAuthRuntime: () => ({ ready: vi.fn().mockResolvedValue(undefined) }),
      createBackendClient: () => ({
        ready: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      }),
    })
    expect((await readiness.check()).status).toBe(503)
  })
})
