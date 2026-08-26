import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose'

import type { PrincipalVerifier } from '../../application/ports/principal-verifier.js'
import type { ExternalPrincipal } from '../../domain/model.js'

export type OidcPrincipalVerifierConfig = Readonly<{
  issuer: string
  audience: string
  jwksUri: string
  algorithms: readonly ['RS256']
  requiredScopes: readonly string[]
  allowInsecureLocalHttp?: boolean
}>

export class PrincipalVerificationError extends Error {
  constructor() {
    super('The access token could not be verified.')
    this.name = 'PrincipalVerificationError'
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' || hostname === '[::1]'
}

function trustedOidcUrl(
  value: string,
  field: string,
  allowInsecureLocalHttp: boolean,
): URL {
  const url = new URL(value)
  if (
    (
      url.protocol !== 'https:' &&
      !(allowInsecureLocalHttp && url.protocol === 'http:' && isLocalHost(url.hostname))
    ) ||
    url.username !== '' || url.password !== '' || url.hash !== ''
  ) {
    throw new Error(`${field} must be HTTPS or explicit local HTTP without credentials or a fragment.`)
  }
  return url
}

function requiredScopesPresent(scopeClaim: unknown, requiredScopes: readonly string[]): boolean {
  if (requiredScopes.length === 0) return true
  if (typeof scopeClaim !== 'string') return false
  const grantedScopes = new Set(scopeClaim.split(' ').filter(Boolean))
  return requiredScopes.every((scope) => grantedScopes.has(scope))
}

export function createOidcPrincipalVerifier(
  config: OidcPrincipalVerifierConfig,
  keyResolver: JWTVerifyGetKey,
): PrincipalVerifier {
  trustedOidcUrl(config.issuer, 'issuer', config.allowInsecureLocalHttp === true)
  if (config.audience.trim() === '') throw new Error('audience must not be empty.')
  if (config.requiredScopes.length === 0) throw new Error('at least one required scope is needed.')
  if (config.requiredScopes.some((scope) => scope.trim() === '')) {
    throw new Error('required scopes must not contain empty values.')
  }

  return {
    async verify(accessToken: string): Promise<ExternalPrincipal> {
      if (accessToken.trim() === '') throw new PrincipalVerificationError()
      try {
        const { payload } = await jwtVerify(accessToken, keyResolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: [...config.algorithms],
          requiredClaims: ['sub', 'exp', 'iat'],
        })
        if (
          typeof payload.sub !== 'string' ||
          payload.sub === '' ||
          !requiredScopesPresent(payload.scope, config.requiredScopes)
        ) {
          throw new PrincipalVerificationError()
        }
        return { issuer: config.issuer, subject: payload.sub }
      } catch (error) {
        if (error instanceof PrincipalVerificationError) throw error
        if (error instanceof joseErrors.JOSEError) throw new PrincipalVerificationError()
        throw new PrincipalVerificationError()
      }
    },
  }
}

export function createRemoteOidcPrincipalVerifier(
  config: OidcPrincipalVerifierConfig,
): PrincipalVerifier {
  const jwksUrl = trustedOidcUrl(
    config.jwksUri,
    'jwksUri',
    config.allowInsecureLocalHttp === true,
  )
  return createOidcPrincipalVerifier(config, createRemoteJWKSet(jwksUrl))
}
