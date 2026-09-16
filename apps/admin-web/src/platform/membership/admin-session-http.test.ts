import { describe, expect, it, vi } from 'vitest'

import { createAdminSessionHttp } from './admin-session-http'

const membership = (authorityRole: 'member' | 'reviewer' | 'administrator' | 'owner') => ({
  schemaVersion: 'place-current-membership.v1',
  membershipId: '01992d20-0000-7000-8000-000000000001',
  authorityRole,
  userGrade: 'standard',
  productTier: 'basic',
})

function runtime(accessToken = 'secret-access-token') {
  return { bff: { resolveSession: vi.fn().mockResolvedValue({ tokens: { accessToken } }) } }
}

describe('administrator session BFF', () => {
  it.each(['reviewer', 'administrator', 'owner'] as const)(
    'allows %s and returns only the safe projection',
    async (authorityRole) => {
      const currentMembership = vi.fn().mockResolvedValue(
        Response.json(membership(authorityRole)),
      )
      const http = createAdminSessionHttp({
        resolveAuthRuntime: () => runtime(),
        createBackendClient: () => ({ ready: vi.fn(), currentMembership }),
        createCorrelationRef: () => 'correlation-1',
      })

      const response = await http.current(new Request('https://admin.example/api/admin/session'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        schemaVersion: 'place-admin-session.v1',
        authorityRole,
        userGrade: 'standard',
        productTier: 'basic',
      })
      expect(JSON.stringify(body)).not.toContain('secret-access-token')
      expect(JSON.stringify(body)).not.toContain('membershipId')
    },
  )

  it('rejects a valid member session before rendering administrator data', async () => {
    const http = createAdminSessionHttp({
      resolveAuthRuntime: () => runtime(),
      createBackendClient: () => ({
        ready: vi.fn(),
        currentMembership: vi.fn().mockResolvedValue(Response.json(membership('member'))),
      }),
      createCorrelationRef: () => 'correlation-2',
    })

    const response = await http.current(new Request('https://admin.example/api/admin/session'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PLACE_ADMIN_AUTHORITY_REQUIRED' })
  })

  it('fails closed when the OIDC runtime is not installed', async () => {
    const http = createAdminSessionHttp({
      resolveAuthRuntime: () => undefined,
      createBackendClient: () => { throw new Error('must not be called') },
      createCorrelationRef: () => 'correlation-3',
    })

    const response = await http.current(new Request('https://admin.example/api/admin/session'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'PLACE_ADMIN_AUTH_UNAVAILABLE' })
  })

  it('returns unauthenticated without calling Backend when no browser session exists', async () => {
    const currentMembership = vi.fn()
    const http = createAdminSessionHttp({
      resolveAuthRuntime: () => ({ bff: { resolveSession: vi.fn().mockResolvedValue(undefined) } }),
      createBackendClient: () => ({ ready: vi.fn(), currentMembership }),
      createCorrelationRef: () => 'correlation-4',
    })

    const response = await http.current(new Request('https://admin.example/api/admin/session'))
    expect(response.status).toBe(401)
    expect(currentMembership).not.toHaveBeenCalled()
  })
})
