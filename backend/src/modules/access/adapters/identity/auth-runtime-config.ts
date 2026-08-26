import { z } from 'zod'

import type { OidcPrincipalVerifierConfig } from './oidc-principal-verifier.js'

const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PLACE_AUTH_MODE: z.enum(['oidc', 'test']),
  PLACE_OIDC_ALLOW_INSECURE_LOCAL_HTTP: z.enum(['true', 'false']).optional(),
})

export type AuthRuntimeConfig =
  | Readonly<{ mode: 'test' }>
  | Readonly<{ mode: 'oidc'; oidc: OidcPrincipalVerifierConfig }>

export function readAuthRuntimeConfig(environment: NodeJS.ProcessEnv): AuthRuntimeConfig {
  const common = commonSchema.parse(environment)
  if (common.PLACE_AUTH_MODE === 'test') {
    if (common.NODE_ENV === 'production') {
      throw new Error('PLACE_AUTH_MODE=test is prohibited in production.')
    }
    return { mode: 'test' }
  }

  const oidc = z
    .object({
      PLACE_OIDC_ISSUER: z.string().url(),
      PLACE_OIDC_AUDIENCE: z.string().min(1),
      PLACE_OIDC_JWKS_URI: z.string().url(),
    })
    .parse(environment)

  return {
    mode: 'oidc',
    oidc: {
      issuer: oidc.PLACE_OIDC_ISSUER,
      audience: oidc.PLACE_OIDC_AUDIENCE,
      jwksUri: oidc.PLACE_OIDC_JWKS_URI,
      algorithms: ['RS256'],
      ...(common.PLACE_OIDC_ALLOW_INSECURE_LOCAL_HTTP === 'true'
        ? { allowInsecureLocalHttp: true }
        : {}),
    },
  }
}
