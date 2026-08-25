import type { ExternalPrincipal, Membership } from '../../domain/model.js'

export interface MembershipDirectory {
  findByPrincipal(principal: ExternalPrincipal): Promise<Membership | undefined>
}
