import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  requireProductMember,
  resolveOptionalProductMember,
  type ProductAuthorizer,
} from './product-authorization.js'

const memberId = '01992d20-0000-7000-8000-000000000001'
const applications = new Set<ReturnType<typeof Fastify>>()

function fixture() {
  const authorizer = vi.fn<ProductAuthorizer>(async (authorization) => {
    if (authorization === 'Bearer active') return { status: 'authorized', memberId }
    if (authorization === 'Bearer unavailable') throw new Error('private policy service')
    if (authorization === 'Bearer suspended' || authorization === 'Bearer tier-denied') {
      return { status: 'access-denied' }
    }
    return { status: 'authentication-required' }
  })
  const app = Fastify({ logger: false })
  applications.add(app)
  app.get('/required', async (request, reply) => {
    const resolved = await requireProductMember(
      request, reply, authorizer, 'library.read',
    )
    if (resolved === undefined) return
    return { memberId: resolved }
  })
  app.get('/optional', async (request, reply) => {
    const resolved = await resolveOptionalProductMember(
      request, reply, authorizer, 'search.read',
    )
    if (resolved.kind === 'replied') return
    return resolved
  })
  return { app, authorizer }
}

afterEach(async () => {
  await Promise.all([...applications].map((application) => application.close()))
  applications.clear()
})

describe('product authorization HTTP seam', () => {
  it('maps required authentication, suspension, tier, and outage decisions consistently', async () => {
    const { app } = fixture()
    const cases = [
      [undefined, 401, 'PLACE_AUTHENTICATION_REQUIRED'],
      ['Bearer suspended', 403, 'PLACE_ACCESS_DENIED'],
      ['Bearer tier-denied', 403, 'PLACE_ACCESS_DENIED'],
      ['Bearer unavailable', 503, 'PLACE_AUTHORIZATION_UNAVAILABLE'],
    ] as const
    for (const [authorization, status, code] of cases) {
      const response = await app.inject({
        method: 'GET', url: '/required',
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ code })
    }
    const active = await app.inject({
      method: 'GET', url: '/required', headers: { authorization: 'Bearer active' },
    })
    expect(active.statusCode).toBe(200)
    expect(active.json()).toEqual({ memberId })
  })

  it('keeps anonymous reads anonymous but applies the same matrix when evidence is sent', async () => {
    const { app, authorizer } = fixture()
    const anonymous = await app.inject({ method: 'GET', url: '/optional' })
    expect(anonymous.json()).toEqual({ kind: 'anonymous' })
    expect(authorizer).not.toHaveBeenCalled()

    for (const [authorization, status] of [
      ['Bearer suspended', 403],
      ['Bearer tier-denied', 403],
      ['Bearer unavailable', 503],
    ] as const) {
      expect((await app.inject({
        method: 'GET', url: '/optional', headers: { authorization },
      })).statusCode).toBe(status)
    }
    const active = await app.inject({
      method: 'GET', url: '/optional', headers: { authorization: 'Bearer active' },
    })
    expect(active.json()).toEqual({ kind: 'member', memberId })
  })
})
