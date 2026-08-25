import { describe, expect, it } from 'vitest'

import { createBrowserMembershipHttp } from './browser-membership-http'

describe('browser membership HTTP', () => {
  it('fails closed when the server-side membership runtime is inactive', async () => {
    const http = createBrowserMembershipHttp({
      resolveAuthRuntime: () => undefined,
      resolveMembershipBackend: () => undefined,
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.currentConsents()

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_MEMBERSHIP_WEB_UNAVAILABLE',
      correlationRef: 'correlation-ref',
    })
  })

  it('publishes current consents without requiring the authentication runtime', async () => {
    const http = createBrowserMembershipHttp({
      resolveAuthRuntime: () => undefined,
      resolveMembershipBackend: () => ({
        ready: async () => new Response(),
        currentConsents: async () =>
          Response.json({
            consents: [
              { document: 'terms-of-service', version: '2026-08-26' },
            ],
            internalPolicy: 'must-not-cross-the-browser-boundary',
          }),
        onboard: async () => new Response(),
      }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.currentConsents()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      consents: [{ document: 'terms-of-service', version: '2026-08-26' }],
    })
  })

  it('requires a valid server-side session before forwarding onboarding', async () => {
    let backendCalled = false
    const http = createBrowserMembershipHttp({
      resolveAuthRuntime: () => ({
        bff: { resolveSession: async () => undefined },
      }),
      resolveMembershipBackend: () => ({
        ready: async () => new Response(),
        currentConsents: async () => new Response(),
        onboard: async () => {
          backendCalled = true
          return new Response()
        },
      }),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.onboard(
      new Request('https://place.example/api/memberships/onboarding', {
        method: 'POST',
        body: '{}',
      }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'PLACE_AUTHENTICATION_REQUIRED',
      correlationRef: 'correlation-ref',
    })
    expect(backendCalled).toBe(false)
  })

  it('keeps the access token server-side while forwarding onboarding', async () => {
    const observedTokens: string[] = []
    const http = createBrowserMembershipHttp({
      resolveAuthRuntime: () => ({
        bff: {
          resolveSession: async () => ({
            id: 'session-id',
            tokens: {
              accessToken: 'server-side-access-token',
              expiresAt: '2026-08-26T01:00:00.000Z',
            },
            expiresAt: '2026-08-26T01:00:00.000Z',
          }),
        },
      }),
      resolveMembershipBackend: () => ({
        ready: async () => new Response(),
        currentConsents: async () => new Response(),
        onboard: async (token) => {
          observedTokens.push(token)
          return Response.json(
            {
              status: 'created',
              membershipId: 'membership-1',
              authorityRole: 'member',
              userGrade: 'newcomer',
              productTier: 'free',
            },
            { status: 201 },
          )
        },
      }),
      createCorrelationRef: () => 'unused',
    })
    const request = new Request('https://place.example/api/memberships/onboarding', {
      method: 'POST',
      headers: {
        cookie: '__Host-place_session=session-id',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      }),
    })

    const response = await http.onboard(request)
    const body = await response.text()

    expect(response.status).toBe(201)
    expect(observedTokens).toEqual(['server-side-access-token'])
    expect(JSON.parse(body)).toEqual({
      status: 'created',
      membershipId: 'membership-1',
      authorityRole: 'member',
      userGrade: 'newcomer',
      productTier: 'free',
    })
    expect(body).not.toContain('server-side-access-token')
  })

  it('reports session-store failure as unavailable instead of unauthenticated', async () => {
    const http = createBrowserMembershipHttp({
      resolveAuthRuntime: () => ({
        bff: {
          resolveSession: async () => {
            throw new Error('database-secret at internal.database.example')
          },
        },
      }),
      resolveMembershipBackend: () => ({
        ready: async () => new Response(),
        currentConsents: async () => new Response(),
        onboard: async () => new Response(),
      }),
      createCorrelationRef: () => 'correlation-ref',
    })

    const response = await http.onboard(
      new Request('https://place.example/api/memberships/onboarding', {
        method: 'POST',
        body: '{}',
      }),
    )
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(JSON.parse(body)).toMatchObject({
      code: 'PLACE_MEMBERSHIP_WEB_UNAVAILABLE',
      correlationRef: 'correlation-ref',
    })
    expect(body).not.toContain('database-secret')
    expect(body).not.toContain('internal.database.example')
  })
})
