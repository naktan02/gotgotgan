import { describe, expect, it } from 'vitest'

import { createBrowserAuthHttp } from './browser-auth-http'
import { createOidcBff, type OidcTransaction } from './oidc-bff'

describe('browser authentication HTTP boundary', () => {
  it('returns a stable unavailable problem when the runtime is inactive', async () => {
    const http = createBrowserAuthHttp({
      resolveRuntime: () => undefined,
      createCorrelationRef: () => 'correlation-reference',
    })

    const response = await http.start()

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual({
      type: 'urn:place:error:browser-auth-unavailable',
      title: 'Browser authentication is temporarily unavailable',
      status: 503,
      code: 'PLACE_BROWSER_AUTH_UNAVAILABLE',
      retryable: true,
      correlationRef: 'correlation-reference',
    })
  })

  it('starts login with an opaque host cookie and a no-store Identity redirect', async () => {
    const transactions: OidcTransaction[] = []
    const entropy = ['transaction-id', 'state-secret', 'nonce-secret', 'pkce-verifier']
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3_600,
      },
      provider: {
        buildAuthorizationUrl: async () =>
          'https://identity.example/oauth/v2/authorize?client_id=place',
        exchangeAuthorizationCode: async () => {
          throw new Error('not used')
        },
      },
      transactionStore: {
        create: async (transaction) => void transactions.push(transaction),
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => entropy.shift()!,
      calculatePkceChallenge: async () => 'pkce-challenge',
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    })
    const http = createBrowserAuthHttp({
      resolveRuntime: () => ({ bff }),
      createCorrelationRef: () => 'unused',
    })

    const response = await http.start()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://identity.example/oauth/v2/authorize?client_id=place',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-place_oidc_tx=transaction-id')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('state-secret')
    expect(cookie).not.toContain('nonce-secret')
    expect(cookie).not.toContain('pkce-verifier')
    expect(transactions).toHaveLength(1)
  })

  it('rejects a callback without a one-time transaction using a correlated safe problem', async () => {
    let providerCalled = false
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3_600,
      },
      provider: {
        buildAuthorizationUrl: async () => 'https://identity.example/authorize',
        exchangeAuthorizationCode: async () => {
          providerCalled = true
          throw new Error('must not exchange an untrusted code')
        },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    })
    const http = createBrowserAuthHttp({
      resolveRuntime: () => ({ bff }),
      createCorrelationRef: () => 'callback-correlation',
    })
    const request = new Request(
      'https://place.example/api/auth/oidc/callback?code=untrusted-code',
    )

    const response = await http.callback(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain('__Host-place_oidc_tx=;')
    expect(await response.json()).toEqual({
      type: 'urn:place:error:oidc-transaction-invalid',
      title: 'Login transaction is invalid or expired',
      status: 400,
      code: 'PLACE_OIDC_TRANSACTION_INVALID',
      retryable: true,
      correlationRef: 'callback-correlation',
    })
    expect(providerCalled).toBe(false)
  })

  it('deletes the server-side session and clears the browser cookie on logout', async () => {
    const deletedSessions: string[] = []
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3_600,
      },
      provider: {
        buildAuthorizationUrl: async () => 'https://identity.example/authorize',
        exchangeAuthorizationCode: async () => {
          throw new Error('not used')
        },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => undefined,
        delete: async (id) => void deletedSessions.push(id),
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    })
    const http = createBrowserAuthHttp({
      resolveRuntime: () => ({ bff }),
      createCorrelationRef: () => 'unused',
    })
    const request = new Request('https://place.example/api/auth/logout', {
      method: 'POST',
      headers: { cookie: '__Host-place_session=opaque-session-id' },
    })

    const response = await http.logout(request)

    expect(deletedSessions).toEqual(['opaque-session-id'])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toContain(
      '__Host-place_session=; Max-Age=0',
    )
  })

  it('sanitizes runtime failures without exposing provider or credential details', async () => {
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3_600,
      },
      provider: {
        buildAuthorizationUrl: async () => {
          throw new Error('client-secret and internal.identity.example')
        },
        exchangeAuthorizationCode: async () => {
          throw new Error('not used')
        },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => 'opaque-value',
      calculatePkceChallenge: async () => 'pkce-challenge',
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    })
    const http = createBrowserAuthHttp({
      resolveRuntime: () => ({ bff }),
      createCorrelationRef: () => 'failure-correlation',
    })

    const response = await http.start()
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(body).toContain('failure-correlation')
    expect(body).not.toContain('client-secret')
    expect(body).not.toContain('internal.identity.example')
  })
})
