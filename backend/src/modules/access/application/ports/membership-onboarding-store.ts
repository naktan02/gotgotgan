import type { Membership, MembershipConsent } from '../../domain/model.js'

export type MembershipOnboardingAttempt = Readonly<{
  membership: Membership
  consents: readonly MembershipConsent[]
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
