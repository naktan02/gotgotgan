import { describe, expect, it } from 'vitest'

import {
  createNextOidcLifecycle,
  createOidcBff,
  defineBrowserAuthApplication,
} from './index.js'

function application(name: 'web' | 'admin') {
  return defineBrowserAuthApplication({
    storageNamespace: `place.${name}-browser-auth.v1`,
    environmentPrefix: name === 'web' ? 'PLACE' : 'PLACE_ADMIN',
    transactionCookieName: `__Host-place_${name}_oidc_tx`,
    sessionCookieName: `__Host-place_${name}_session`,
    lifecycleKey: `place.${name}.oidc.lifecycle.test`,
  })
}

function bffFor(name: 'web' | 'admin') {
  const entropy = ['transaction', 'state', 'nonce', 'verifier']
  return createOidcBff({
    application: application(name),
    config: {
      callbackUrl: `https://${name}.example/api/auth/oidc/callback`,
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
      delete: async () => undefined,
    },
    randomValue: () => entropy.shift()!,
    calculatePkceChallenge: async () => 'challenge',
    now: () => new Date('2026-09-03T00:00:00.000Z'),
  })
}

describe('browser authentication application seam', () => {
  it('requires distinct host-only cookie names', () => {
    expect(() => defineBrowserAuthApplication({
      storageNamespace: 'place.invalid-browser-auth.v1',
      environmentPrefix: 'PLACE_INVALID',
      transactionCookieName: 'session',
      sessionCookieName: 'session',
      lifecycleKey: 'place.invalid.oidc.lifecycle',
    })).toThrow('Browser authentication application configuration is invalid')
  })

  it('keeps user and administrator cookies distinct on the same host', async () => {
    const web = await bffFor('web').start()
    const admin = await bffFor('admin').start()

    expect(web.headers.get('set-cookie')).toContain('__Host-place_web_oidc_tx=')
    expect(web.headers.get('set-cookie')).not.toContain('__Host-place_admin_oidc_tx=')
    expect(admin.headers.get('set-cookie')).toContain('__Host-place_admin_oidc_tx=')
    expect(admin.headers.get('set-cookie')).not.toContain('__Host-place_web_oidc_tx=')
  })

  it('reads activation only from the configured application prefix', async () => {
    const lifecycle = createNextOidcLifecycle({
      application: application('admin'),
      createProvider: async () => {
        throw new Error('must not create provider while disabled')
      },
      createRuntime: async () => {
        throw new Error('must not create runtime while disabled')
      },
    })

    await expect(lifecycle.install({ PLACE_OIDC_RUNTIME_ENABLED: 'true' }))
      .resolves.toEqual({ state: 'disabled' })
  })
})
