import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { readAuthRuntimeConfig } from '../adapters/identity/auth-runtime-config.js'
import {
  createOidcPrincipalVerifier,
  PrincipalVerificationError,
  type OidcPrincipalVerifierConfig,
} from '../adapters/identity/oidc-principal-verifier.js'
import { createTestPrincipalVerifier } from '../adapters/identity/test-principal-verifier.js'

const issuer = 'https://identity.example'
const audience = 'place-service'

async function signedToken(
  overrides: Readonly<Record<string, unknown>> = {},
  tokenAudience = audience,
) {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ scope: 'place.read', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setSubject('subject-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey)
  return {
    token,
    keyResolver: createLocalJWKSet({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'test-key' }] }),
  }
}

function config(): OidcPrincipalVerifierConfig {
  return {
    issuer,
    audience,
    jwksUri: 'https://identity.example/jwks',
    algorithms: ['RS256'],
  }
}

describe('OIDC principal verification', () => {
  it('returns only exact issuer and subject when a valid access token has no scope claim', async () => {
    const { token, keyResolver } = await signedToken({
      scope: undefined,
      email: 'display-only@example.test',
    })
    const verifier = createOidcPrincipalVerifier(config(), keyResolver)
    await expect(verifier.verify(token)).resolves.toEqual({ issuer, subject: 'subject-1' })
  })

  it('rejects a wrong audience with a safe error', async () => {
    const wrongAudience = await signedToken({}, 'another-service')
    await expect(
      createOidcPrincipalVerifier(config(), wrongAudience.keyResolver).verify(wrongAudience.token),
    ).rejects.toEqual(new PrincipalVerificationError())
    expect((await signedToken()).token).not.toContain('subject-1')
  })

  it('rejects non-HTTPS trust anchors before token processing', async () => {
    const { keyResolver } = await signedToken()
    expect(() =>
      createOidcPrincipalVerifier({ ...config(), issuer: 'http://identity.example' }, keyResolver),
    ).toThrow(/HTTPS or explicit local HTTP/)
  })

  it('allows explicit local HTTP without allowing arbitrary insecure issuers', async () => {
    const { keyResolver } = await signedToken()
    expect(() => createOidcPrincipalVerifier({
      ...config(),
      issuer: 'http://identity.localhost',
    }, keyResolver)).toThrow(/HTTPS or explicit local HTTP/)
    expect(() => createOidcPrincipalVerifier({
      ...config(),
      issuer: 'http://identity.localhost',
      jwksUri: 'http://identity.localhost/oauth/v2/keys',
      allowInsecureLocalHttp: true,
    }, keyResolver)).not.toThrow()
    expect(() => createOidcPrincipalVerifier({
      ...config(),
      issuer: 'http://identity.internal.example',
      allowInsecureLocalHttp: true,
    }, keyResolver)).toThrow(/HTTPS or explicit local HTTP/)
  })
})

describe('authentication runtime modes', () => {
  it('rejects the explicit local test adapter in production', () => {
    expect(() =>
      readAuthRuntimeConfig({ NODE_ENV: 'production', PLACE_AUTH_MODE: 'test' }),
    ).toThrow(/prohibited/)
  })

  it('requires every OIDC setting instead of using endpoint defaults', () => {
    expect(() =>
      readAuthRuntimeConfig({ NODE_ENV: 'production', PLACE_AUTH_MODE: 'oidc' }),
    ).toThrow()
  })

  it('allows a deterministic token map only in a non-production test composition', async () => {
    expect(readAuthRuntimeConfig({ NODE_ENV: 'test', PLACE_AUTH_MODE: 'test' })).toEqual({
      mode: 'test',
    })
    const verifier = createTestPrincipalVerifier(
      new Map([['test-token', { issuer, subject: 'subject-1' }]]),
    )
    await expect(verifier.verify('test-token')).resolves.toEqual({ issuer, subject: 'subject-1' })
    await expect(verifier.verify('unknown')).rejects.toBeInstanceOf(PrincipalVerificationError)
  })
})
