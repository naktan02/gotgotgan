import type { PrincipalVerifier } from '../../application/ports/principal-verifier.js'
import type { ExternalPrincipal } from '../../domain/model.js'
import { PrincipalVerificationError } from './oidc-principal-verifier.js'

export function createTestPrincipalVerifier(
  tokenPrincipals: ReadonlyMap<string, ExternalPrincipal>,
): PrincipalVerifier {
  return {
    async verify(accessToken) {
      const principal = tokenPrincipals.get(accessToken)
      if (principal === undefined) throw new PrincipalVerificationError()
      return principal
    },
  }
}
