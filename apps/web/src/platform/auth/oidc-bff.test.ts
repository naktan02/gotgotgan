import { describe, expect, it } from 'vitest'

import { createOidcBff, type OidcTransaction } from './oidc-bff'

describe('OIDC browser BFF', () => {
  it.each([
    ['an insecure callback', { callbackUrl: 'http://place.example/api/auth/oidc/callback' }],
    ['an external post-login redirect', { postLoginPath: '//attacker.example' }],
    ['missing openid scope', { scopes: ['profile'] }],
    ['a non-positive transaction TTL', { transactionTtlSeconds: 0 }],
    ['a non-positive session TTL', { sessionTtlSeconds: -1 }],
  ])('rejects unsafe configuration: %s', (_label, override) => {
    expect(() => createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
        ...override,
      },
      provider: {
        buildAuthorizationUrl: async () => 'https://identity.example',
        exchangeAuthorizationCode: async () => { throw new Error('not used') },
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
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })).toThrow('Invalid OIDC BFF configuration')
  })

  it('starts authorization while keeping state, nonce, and PKCE verifier server-side', async () => {
    const transactions: OidcTransaction[] = []
    const authorizationRequests: unknown[] = []
    const entropy = ['transaction-opaque-id', 'oauth-state-secret', 'nonce-secret', 'pkce-verifier']
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid', 'profile'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async (request) => {
          authorizationRequests.push(request)
          return 'https://identity.example/oauth/v2/authorize?client_id=place'
        },
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
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    const response = await bff.start()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://identity.example/oauth/v2/authorize?client_id=place',
    )
    expect(authorizationRequests).toEqual([
      {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        scopes: ['openid', 'profile'],
        state: 'oauth-state-secret',
        nonce: 'nonce-secret',
        pkceChallenge: 'pkce-challenge',
      },
    ])
    expect(transactions).toEqual([
      {
        id: 'transaction-opaque-id',
        state: 'oauth-state-secret',
        nonce: 'nonce-secret',
        pkceVerifier: 'pkce-verifier',
        expiresAt: '2026-08-25T12:05:00.000Z',
      },
    ])
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('__Host-place_oidc_tx=transaction-opaque-id')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('oauth-state-secret')
    expect(cookie).not.toContain('nonce-secret')
    expect(cookie).not.toContain('pkce-verifier')
  })

  it('completes callback into an opaque browser session without exposing tokens', async () => {
    const sessions: unknown[] = []
    const exchanges: unknown[] = []
    const transaction: OidcTransaction = {
      id: 'transaction-opaque-id',
      state: 'oauth-state-secret',
      nonce: 'nonce-secret',
      pkceVerifier: 'pkce-verifier',
      expiresAt: '2026-08-25T12:05:00.000Z',
    }
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid', 'profile'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async (request) => {
          exchanges.push(request)
          return {
            accessToken: 'access-token-secret',
            refreshToken: 'refresh-token-secret',
            expiresAt: '2026-08-25T12:30:00.000Z',
          }
        },
      },
      transactionStore: {
        create: async () => undefined,
        take: async (id) => id === transaction.id ? transaction : undefined,
      },
      sessionStore: {
        create: async (session) => void sessions.push(session),
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => 'session-opaque-id',
      calculatePkceChallenge: async () => { throw new Error('not used') },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })
    const request = new Request(
      'https://place.example/api/auth/oidc/callback?code=authorization-code&state=oauth-state-secret',
      { headers: { cookie: '__Host-place_oidc_tx=transaction-opaque-id' } },
    )

    const response = await bff.callback(request)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(exchanges).toEqual([
      {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        currentUrl:
          'https://place.example/api/auth/oidc/callback?code=authorization-code&state=oauth-state-secret',
        state: 'oauth-state-secret',
        nonce: 'nonce-secret',
        pkceVerifier: 'pkce-verifier',
      },
    ])
    expect(sessions).toEqual([
      {
        id: 'session-opaque-id',
        tokens: {
          accessToken: 'access-token-secret',
          refreshToken: 'refresh-token-secret',
          expiresAt: '2026-08-25T12:30:00.000Z',
        },
        expiresAt: '2026-08-25T12:30:00.000Z',
      },
    ])
    const cookies = response.headers.get('set-cookie') ?? ''
    expect(cookies).toContain('__Host-place_session=session-opaque-id')
    expect(cookies).toContain('__Host-place_oidc_tx=;')
    expect(cookies).not.toContain('access-token-secret')
    expect(cookies).not.toContain('refresh-token-secret')
    expect(response.headers.get('location')).not.toContain('authorization-code')
  })

  it('fails closed with a safe problem when the one-time transaction is missing', async () => {
    let exchangeCalled = false
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => {
          exchangeCalled = true
          throw new Error('must not run')
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
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    const response = await bff.callback(
      new Request('https://place.example/api/auth/oidc/callback?code=untrusted'),
    )

    expect(response.status).toBe(400)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      type: 'urn:place:error:oidc-transaction-invalid',
      title: 'Login transaction is invalid or expired',
      status: 400,
      code: 'PLACE_OIDC_TRANSACTION_INVALID',
      retryable: true,
    })
    expect(response.headers.get('set-cookie')).toContain('__Host-place_oidc_tx=;')
    expect(exchangeCalled).toBe(false)
    expect(body).not.toContain('untrusted')
  })

  it('sanitizes provider callback failures and creates no browser session', async () => {
    let sessionCreated = false
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => {
          throw new Error('authorization-code-secret and internal endpoint')
        },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => ({
          id: 'transaction-opaque-id',
          state: 'state-secret',
          nonce: 'nonce-secret',
          pkceVerifier: 'pkce-secret',
          expiresAt: '2026-08-25T12:05:00.000Z',
        }),
      },
      sessionStore: {
        create: async () => { sessionCreated = true },
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    const response = await bff.callback(
      new Request(
        'https://place.example/api/auth/oidc/callback?code=authorization-code-secret&state=state-secret',
        { headers: { cookie: '__Host-place_oidc_tx=transaction-opaque-id' } },
      ),
    )

    expect(response.status).toBe(400)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({
      code: 'PLACE_OIDC_CALLBACK_REJECTED',
      retryable: true,
    })
    expect(body).not.toContain('authorization-code-secret')
    expect(body).not.toContain('internal endpoint')
    expect(response.headers.get('set-cookie')).toContain('__Host-place_oidc_tx=;')
    expect(sessionCreated).toBe(false)
  })

  it('rejects an expired provider token set before creating a session', async () => {
    let sessionCreated = false
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => ({
          accessToken: 'expired-token',
          expiresAt: '2026-08-25T11:59:59.000Z',
        }),
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => ({
          id: 'transaction-opaque-id',
          state: 'state-secret',
          nonce: 'nonce-secret',
          pkceVerifier: 'pkce-secret',
          expiresAt: '2026-08-25T12:05:00.000Z',
        }),
      },
      sessionStore: {
        create: async () => { sessionCreated = true },
        find: async () => undefined,
        delete: async () => undefined,
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    const response = await bff.callback(new Request(
      'https://place.example/api/auth/oidc/callback?code=code&state=state-secret',
      { headers: { cookie: '__Host-place_oidc_tx=transaction-opaque-id' } },
    ))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PLACE_OIDC_CALLBACK_REJECTED' })
    expect(sessionCreated).toBe(false)
  })

  it('closes the server-side session and clears the opaque browser cookie on logout', async () => {
    const deleted: string[] = []
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => { throw new Error('not used') },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => undefined,
        delete: async (id) => { deleted.push(id) },
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    const response = await bff.logout(new Request('https://place.example/api/auth/logout', {
      headers: { cookie: '__Host-place_session=opaque-session-id' },
    }))

    expect(deleted).toEqual(['opaque-session-id'])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('set-cookie')).toContain('__Host-place_session=; Max-Age=0')
  })

  it('restores an unexpired server-side session from the opaque browser cookie', async () => {
    const session = {
      id: 'opaque-session-id',
      tokens: {
        accessToken: 'access-token-secret',
        refreshToken: 'refresh-token-secret',
        expiresAt: '2026-08-25T12:30:00.000Z',
      },
      expiresAt: '2026-08-25T12:30:00.000Z',
    }
    const deleted: string[] = []
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => { throw new Error('not used') },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async (id: string) => id === session.id ? session : undefined,
        delete: async (id) => { deleted.push(id) },
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    await expect(bff.resolveSession(new Request('https://place.example/', {
      headers: { cookie: '__Host-place_session=opaque-session-id' },
    }))).resolves.toEqual(session)
    expect(deleted).toEqual([])
  })

  it('deletes an expired server-side session instead of restoring its tokens', async () => {
    const deleted: string[] = []
    const bff = createOidcBff({
      config: {
        callbackUrl: 'https://place.example/api/auth/oidc/callback',
        postLoginPath: '/',
        scopes: ['openid'],
        transactionTtlSeconds: 300,
        sessionTtlSeconds: 3600,
      },
      provider: {
        buildAuthorizationUrl: async () => { throw new Error('not used') },
        exchangeAuthorizationCode: async () => { throw new Error('not used') },
      },
      transactionStore: {
        create: async () => undefined,
        take: async () => undefined,
      },
      sessionStore: {
        create: async () => undefined,
        find: async () => ({
          id: 'expired-session-id',
          tokens: {
            accessToken: 'expired-access-token-secret',
            expiresAt: '2026-08-25T11:59:59.000Z',
          },
          expiresAt: '2026-08-25T11:59:59.000Z',
        }),
        delete: async (id) => { deleted.push(id) },
      },
      randomValue: () => 'unused',
      calculatePkceChallenge: async () => 'unused',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    await expect(bff.resolveSession(new Request('https://place.example/', {
      headers: { cookie: '__Host-place_session=expired-session-id' },
    }))).resolves.toBeUndefined()
    expect(deleted).toEqual(['expired-session-id'])
  })
})
