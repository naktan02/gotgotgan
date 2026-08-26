import type { ExternalPrincipal, Membership } from '../../domain/model.js'
import type { PlatformEntitlementEvidence } from './platform-entitlement-source.js'

export type PlatformOwnerProjectionAttempt = Readonly<{
  principal: ExternalPrincipal
  evidence: PlatformEntitlementEvidence
  occurredAt: string
}>

export type PlatformOwnerProjectionOutcome = Readonly<{
  status: 'projected' | 'unchanged' | 'stale'
  membership?: Membership
}>

export interface PlatformOwnerProjectionStore {
  synchronizePlatformOwner(
    attempt: PlatformOwnerProjectionAttempt,
  ): Promise<PlatformOwnerProjectionOutcome>
}
