import type { ExternalPrincipal } from '../../domain/model.js'

export interface PrincipalVerifier {
  verify(accessToken: string): Promise<ExternalPrincipal>
}
