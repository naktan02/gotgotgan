import type { ExternalPrincipal } from '../../domain/model.js'

export const platformRoleCodes = [
  'platform_operator',
  'platform_admin',
  'platform_owner',
] as const

export type PlatformRoleCode = (typeof platformRoleCodes)[number]

export type PlatformEntitlementEvidence = Readonly<{
  roles: readonly PlatformRoleCode[]
  revision: number
  ownerRevision: number
  expiresAt: string
}>

export interface PlatformEntitlementSource {
  evaluate(input: Readonly<{
    accessToken: string
    principal: ExternalPrincipal
  }>): Promise<PlatformEntitlementEvidence>
}
