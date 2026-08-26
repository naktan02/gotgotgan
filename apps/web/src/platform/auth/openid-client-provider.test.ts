import { describe, expect, it } from 'vitest'

import { createOpenidClientProvider } from './openid-client-provider'

describe('openid-client provider adapter', () => {
  it('discovers the configured issuer and sends Authorization Code + PKCE parameters', async () => {
    const calls: Array<readonly [string, ...unknown[]]> = []
    const configuration = { id: 'discovered-configuration' }
    const provider = await createOpenidClientProvider({
      issuer: 'https://identity.example',
      clientId: 'place-client',
      clientSecret: 'client-secret',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    }, {
      clientSecretBasic: (secret) => {
        calls.push(['clientSecretBasic', secret])
        return { secret }
      },
      discovery: async (...arguments_) => {
        calls.push(['discovery', ...arguments_])
        return configuration
      },
      buildAuthorizationUrl: (receivedConfiguration, parameters) => {
        calls.push(['buildAuthorizationUrl', receivedConfiguration, parameters])
        return new URL('https://identity.example/oauth/v2/authorize')
      },
      authorizationCodeGrant: async (...arguments_) => {
        calls.push(['authorizationCodeGrant', ...arguments_])
        return {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expiresIn: () => 900,
        }
      },
    })

    expect(calls).toEqual([
      ['clientSecretBasic', 'client-secret'],
      [
        'discovery',
        new URL('https://identity.example'),
        'place-client',
        undefined,
        { secret: 'client-secret' },
        undefined,
      ],
    ])

    await expect(provider.buildAuthorizationUrl({
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      scopes: ['openid', 'profile'],
      state: 'state-secret',
      nonce: 'nonce-secret',
      pkceChallenge: 'challenge',
    })).resolves.toBe('https://identity.example/oauth/v2/authorize')

    await expect(provider.exchangeAuthorizationCode({
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      currentUrl: 'https://place.example/api/auth/oidc/callback?code=code&state=state-secret',
      state: 'state-secret',
      nonce: 'nonce-secret',
      pkceVerifier: 'verifier-secret',
    })).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-08-25T12:15:00.000Z',
    })

    expect(calls.at(-2)).toEqual([
      'buildAuthorizationUrl',
      configuration,
      {
        redirect_uri: 'https://place.example/api/auth/oidc/callback',
        scope: 'openid profile',
        state: 'state-secret',
        nonce: 'nonce-secret',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        response_type: 'code',
      },
    ])
    expect(calls.at(-1)).toEqual([
      'authorizationCodeGrant',
      configuration,
      new URL('https://place.example/api/auth/oidc/callback?code=code&state=state-secret'),
      {
        pkceCodeVerifier: 'verifier-secret',
        expectedState: 'state-secret',
        expectedNonce: 'nonce-secret',
        idTokenExpected: true,
      },
      { redirect_uri: 'https://place.example/api/auth/oidc/callback' },
    ])
  })

  it('rejects token responses without a positive expiry', async () => {
    const provider = await createOpenidClientProvider({
      issuer: 'https://identity.example',
      clientId: 'place-client',
      clientSecret: 'client-secret',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    }, {
      clientSecretBasic: () => ({}),
      discovery: async () => ({}),
      buildAuthorizationUrl: () => new URL('https://identity.example/authorize'),
      authorizationCodeGrant: async () => ({
        access_token: 'access-token',
        expiresIn: () => undefined,
      }),
    })

    await expect(provider.exchangeAuthorizationCode({
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      currentUrl: 'https://place.example/api/auth/oidc/callback?code=code&state=state',
      state: 'state',
      nonce: 'nonce',
      pkceVerifier: 'verifier',
    })).rejects.toThrow('OIDC token expiry is missing or invalid')
  })

  it('enables the driver exception only for an explicit local issuer', async () => {
    const discoveryOptions: unknown[] = []
    await createOpenidClientProvider({
      issuer: 'http://identity.localhost',
      clientId: 'place-local-client',
      clientSecret: 'client-secret',
      allowInsecureLocalHttp: true,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    }, {
      clientSecretBasic: () => ({}),
      discovery: async (_issuer, _clientId, _metadata, _authentication, options) => {
        discoveryOptions.push(options)
        return {}
      },
      buildAuthorizationUrl: () => new URL('http://identity.localhost/oauth/v2/authorize'),
      authorizationCodeGrant: async () => ({
        access_token: 'access-token',
        expiresIn: () => 300,
      }),
    })

    expect(discoveryOptions).toHaveLength(1)
    expect(discoveryOptions[0]).toMatchObject({ execute: [expect.any(Function)] })
    await createOpenidClientProvider({
      issuer: 'https://identity.example',
      clientId: 'place-client',
      clientSecret: 'client-secret',
      allowInsecureLocalHttp: true,
      now: () => new Date(),
    }, {
      clientSecretBasic: () => ({}),
      discovery: async (_issuer, _clientId, _metadata, _authentication, options) => {
        discoveryOptions.push(options)
        return {}
      },
      buildAuthorizationUrl: () => new URL('https://identity.example'),
      authorizationCodeGrant: async () => ({ access_token: 'token', expiresIn: () => 300 }),
    })
    expect(discoveryOptions[1]).toBeUndefined()
    await expect(createOpenidClientProvider({
      issuer: 'http://identity.internal.example',
      clientId: 'place-client',
      clientSecret: 'client-secret',
      allowInsecureLocalHttp: true,
      now: () => new Date(),
    }, {
      clientSecretBasic: () => ({}),
      discovery: async () => ({}),
      buildAuthorizationUrl: () => new URL('https://identity.example'),
      authorizationCodeGrant: async () => ({ access_token: 'token', expiresIn: () => 300 }),
    })).rejects.toThrow('Invalid OIDC provider configuration')
  })
})
