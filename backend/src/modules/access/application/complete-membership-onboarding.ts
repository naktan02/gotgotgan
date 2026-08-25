import type {
  ExternalPrincipal,
  Membership,
  MembershipConsent,
  ProductTier,
  UserGrade,
} from '../domain/model.js'
import type {
  MembershipOnboardingOutcome,
  MembershipOnboardingStore,
} from './ports/membership-onboarding-store.js'

export class MembershipConsentRequiredError extends Error {
  constructor() {
    super('The current Place membership consent set must be accepted.')
    this.name = 'MembershipConsentRequiredError'
  }
}

export class InvalidMembershipOnboardingPolicyError extends Error {
  constructor() {
    super('The Place membership onboarding policy is invalid.')
    this.name = 'InvalidMembershipOnboardingPolicyError'
  }
}

export type MembershipOnboardingPolicy = Readonly<{
  requiredConsents: readonly MembershipConsent[]
  initialUserGrade: UserGrade
  initialProductTier: ProductTier
}>

function consentKeys(consents: readonly MembershipConsent[]): readonly string[] | undefined {
  if (consents.length === 0) return undefined
  const keys = consents.map((consent) => {
    if (consent.document.trim() === '' || consent.version.trim() === '') return undefined
    return `${consent.document.length}:${consent.document}${consent.version.length}:${consent.version}`
  })
  if (keys.some((key) => key === undefined)) return undefined
  const uniqueKeys = new Set(keys as string[])
  if (uniqueKeys.size !== keys.length) return undefined
  return [...uniqueKeys].sort()
}

function hasCurrentConsentSet(
  accepted: readonly MembershipConsent[],
  requiredKeys: readonly string[],
): boolean {
  const acceptedKeys = consentKeys(accepted)
  return acceptedKeys !== undefined &&
    acceptedKeys.length === requiredKeys.length &&
    acceptedKeys.every((key, index) => key === requiredKeys[index])
}

export async function completeMembershipOnboarding(input: Readonly<{
  principal: ExternalPrincipal
  acceptedConsents: readonly MembershipConsent[]
  policy: MembershipOnboardingPolicy
  store: MembershipOnboardingStore
  nextMembershipId: () => string
  now: () => Date
}>): Promise<MembershipOnboardingOutcome> {
  const requiredKeys = consentKeys(input.policy.requiredConsents)
  if (
    requiredKeys === undefined ||
    input.policy.initialUserGrade.trim() === '' ||
    input.policy.initialProductTier.trim() === ''
  ) {
    throw new InvalidMembershipOnboardingPolicyError()
  }
  if (!hasCurrentConsentSet(input.acceptedConsents, requiredKeys)) {
    throw new MembershipConsentRequiredError()
  }

  const membership: Membership = {
    id: input.nextMembershipId(),
    principal: input.principal,
    status: 'active',
    authorityRole: 'member',
    userGrade: input.policy.initialUserGrade,
    productTier: input.policy.initialProductTier,
    resourceGrants: [],
  }
  return input.store.attemptAndAuditOnboarding({
    membership,
    consents: input.policy.requiredConsents,
    occurredAt: input.now().toISOString(),
  })
}
