export {
  decideAccess,
  type AccessDecision,
  type AccessDecisionReason,
  type AccessRequest,
} from './domain/authorization.js'
export {
  authorityRoles,
  externalPrincipalKey,
  grantablePermissions,
  membershipStatuses,
  placePermissions,
  type AccessSubject,
  type AuthorityRole,
  type ExternalPrincipal,
  type GrantablePermission,
  type Membership,
  type MembershipConsent,
  type MembershipStatus,
  type PlacePermission,
  type ProductTier,
  type ResourceGrant,
  type ResourceScope,
  type UserGrade,
} from './domain/model.js'
export {
  decideOwnershipChange,
  type OwnershipChange,
  type OwnershipDecision,
} from './domain/ownership.js'
export {
  authorizeAndAudit,
  resolveAccessSubject,
  UnregisteredPrincipalError,
} from './application/resolve-access.js'
export {
  bootstrapInitialOwner,
  MembershipAlreadyInitializedError,
} from './application/bootstrap-initial-owner.js'
export {
  changeMembershipAuthorityRole,
  type MembershipAuthorityRoleChange,
} from './application/change-membership-authority-role.js'
export {
  completeMembershipOnboarding,
  InvalidMembershipOnboardingPolicyError,
  MembershipConsentRequiredError,
  type MembershipOnboardingPolicy,
} from './application/complete-membership-onboarding.js'
export type { AccessAuditEvent, AccessAuditSink } from './application/ports/access-audit-sink.js'
export type {
  BootstrapAuthority,
  VerifiedOperatorAuthority,
} from './application/ports/bootstrap-authority.js'
export type {
  InitialOwnerAttempt,
  InitialOwnerStore,
} from './application/ports/initial-owner-store.js'
export type { MembershipDirectory } from './application/ports/membership-directory.js'
export type {
  MembershipOnboardingAttempt,
  MembershipOnboardingOutcome,
  MembershipOnboardingStore,
} from './application/ports/membership-onboarding-store.js'
export type { PrincipalVerifier } from './application/ports/principal-verifier.js'
export type {
  AuthorityRoleChangeStore,
  AuthorityRoleChangeAttempt,
} from './application/ports/authority-role-change-store.js'
export {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from './transport/http/register-access-http.js'
export { PostgresAccessStore } from './adapters/persistence/postgres-access-store.js'
