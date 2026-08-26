import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
  type KeyInput,
} from 'jose'
import { z } from 'zod'

import type {
  PlatformEntitlementEvidence,
  PlatformEntitlementSource,
} from '../../application/ports/platform-entitlement-source.js'
import { platformRoleCodes } from '../../application/ports/platform-entitlement-source.js'

const responseSchema = z.object({
  contract: z.literal('platform-entitlement-response.v1'),
  assertion: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict()

const assertionSchema = z.object({
  contract: z.literal('platform-entitlement-assertion.v1'),
  identity_issuer: z.string().min(1),
  roles: z.array(z.enum(platformRoleCodes)).refine(
    (roles) => new Set(roles).size === roles.length,
    'roles must be unique',
  ),
  revision: z.number().int().nonnegative(),
  owner_revision: z.number().int().nonnegative(),
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  sub: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
}).strict()

export type PlatformEntitlementSourceConfig = Readonly<{
  endpoint: URL
  audience: string
  assertionIssuer: string
  verificationKey: KeyInput | JWTVerifyGetKey
  now?: () => Date
  fetch?: typeof fetch
  timeoutMs?: number
}>

export class PlatformEntitlementVerificationError extends Error {
  constructor() {
    super('The platform entitlement could not be verified.')
    this.name = 'PlatformEntitlementVerificationError'
  }
}

function assertTrustedEndpoint(endpoint: URL): void {
  const localHttp = endpoint.protocol === 'http:' && (
    endpoint.hostname === 'localhost' || endpoint.hostname.endsWith('.localhost') ||
    endpoint.hostname === '127.0.0.1' || endpoint.hostname === '[::1]' ||
    endpoint.hostname === 'identity-platform-access'
  )
  if (
    (endpoint.protocol !== 'https:' && !localHttp) ||
    endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== ''
  ) {
    throw new Error('platform entitlement endpoint must be HTTPS or an approved local endpoint.')
  }
}

export function createPlatformEntitlementSource(
  config: PlatformEntitlementSourceConfig,
): PlatformEntitlementSource {
  assertTrustedEndpoint(config.endpoint)
  if (config.audience.trim() === '' || config.assertionIssuer.trim() === '') {
    throw new Error('platform entitlement audience and assertion issuer are required.')
  }
  const fetchImplementation = config.fetch ?? fetch
  const timeoutMs = config.timeoutMs ?? 3_000

  return {
    async evaluate({ accessToken, principal }): Promise<PlatformEntitlementEvidence> {
      if (accessToken.trim() === '') throw new PlatformEntitlementVerificationError()
      try {
        const response = await fetchImplementation(config.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessToken, audience: config.audience }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) throw new PlatformEntitlementVerificationError()
        const body = responseSchema.parse(await response.json())
        const { payload, protectedHeader } = await jwtVerify(
          body.assertion,
          config.verificationKey,
          {
            issuer: config.assertionIssuer,
            audience: config.audience,
            algorithms: ['ES256'],
            requiredClaims: ['sub', 'exp', 'iat', 'jti'],
            ...(config.now === undefined ? {} : { currentDate: config.now() }),
          },
        )
        if (protectedHeader.typ !== 'platform-entitlement+jwt') {
          throw new PlatformEntitlementVerificationError()
        }
        const assertion = assertionSchema.parse(payload)
        if (
          assertion.identity_issuer !== principal.issuer ||
          assertion.sub !== principal.subject
        ) {
          throw new PlatformEntitlementVerificationError()
        }
        const expiresAt = new Date(assertion.exp * 1_000).toISOString()
        if (expiresAt !== new Date(body.expiresAt).toISOString()) {
          throw new PlatformEntitlementVerificationError()
        }
        return {
          roles: assertion.roles,
          revision: assertion.revision,
          ownerRevision: assertion.owner_revision,
          expiresAt,
        }
      } catch (error) {
        if (error instanceof PlatformEntitlementVerificationError) throw error
        if (error instanceof joseErrors.JOSEError || error instanceof z.ZodError) {
          throw new PlatformEntitlementVerificationError()
        }
        throw new PlatformEntitlementVerificationError()
      }
    },
  }
}

export function createRemotePlatformEntitlementSource(
  config: Omit<PlatformEntitlementSourceConfig, 'verificationKey'> & Readonly<{ jwksUri: URL }>,
): PlatformEntitlementSource {
  assertTrustedEndpoint(config.jwksUri)
  return createPlatformEntitlementSource({
    ...config,
    verificationKey: createRemoteJWKSet(config.jwksUri),
  })
}
