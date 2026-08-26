import type { Membership, MembershipConsent } from '../../domain/model.js'
import type { PlatformEntitlementEvidence } from './platform-entitlement-source.js'

export type MembershipOnboardingAttempt = Readonly<{
  membership: Membership
  consents: readonly MembershipConsent[]
  platformEntitlement?: PlatformEntitlementEvidence
  occurredAt: string
}>

export type MembershipOnboardingOutcome = Readonly<{
  status: 'created' | 'existing'
  membership: Membership
}>

export interface MembershipOnboardingStore {
  attemptAndAuditOnboarding(
    attempt: MembershipOnboardingAttempt,
  ): Promise<MembershipOnboardingOutcome>
}
