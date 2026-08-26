import { generateKeyPairSync } from 'node:crypto'

import { importPKCS8, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { createPlatformEntitlementSource } from './remote-platform-entitlement-source.js'

describe('remote platform entitlement source', () => {
  it('verifies the signed audience and exact external principal', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const signingKey = await importPKCS8(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'ES256',
    )
    const assertion = await new SignJWT({
      contract: 'platform-entitlement-assertion.v1',
      identity_issuer: 'https://identity.example',
      roles: ['platform_owner'],
      revision: 8,
      owner_revision: 3,
    })
      .setProtectedHeader({
        alg: 'ES256',
        kid: 'platform-key-1',
        typ: 'platform-entitlement+jwt',
      })
      .setIssuer('personal-identity-platform-access')
      .setAudience('place-api')
      .setSubject('subject-1')
      .setIssuedAt(new Date('2026-08-27T00:00:00.000Z'))
      .setExpirationTime(new Date('2026-08-27T00:01:00.000Z'))
      .setJti('assertion-1')
      .sign(signingKey)
    const source = createPlatformEntitlementSource({
      endpoint: new URL('https://identity.internal/internal/v1/entitlements/evaluate'),
      audience: 'place-api',
      assertionIssuer: 'personal-identity-platform-access',
      verificationKey: publicKey,
      now: () => new Date('2026-08-27T00:00:30.000Z'),
      fetch: async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          accessToken: 'user-token',
          audience: 'place-api',
        })
        return new Response(JSON.stringify({
          contract: 'platform-entitlement-response.v1',
          assertion,
          expiresAt: '2026-08-27T00:01:00.000Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    await expect(source.evaluate({
      accessToken: 'user-token',
      principal: { issuer: 'https://identity.example', subject: 'subject-1' },
    })).resolves.toEqual({
      roles: ['platform_owner'],
      revision: 8,
      ownerRevision: 3,
      expiresAt: '2026-08-27T00:01:00.000Z',
    })
  })
})
