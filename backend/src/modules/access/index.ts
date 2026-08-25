export {
  decideAccess,
  type AccessDecision,
  type AccessDecisionReason,
  type AccessRequest,
} from './domain/authorization.js'
export {
  authorityRoles,
  externalPrincipalKey,
  membershipStatuses,
  placePermissions,
  type AccessSubject,
  type AuthorityRole,
  type ExternalPrincipal,
  type GrantablePermission,
  type Membership,
  type MembershipStatus,
  type PlacePermission,
  type ResourceGrant,
  type ResourceScope,
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
export type { PrincipalVerifier } from './application/ports/principal-verifier.js'
export {
  registerAccessHttpRoutes,
  type AccessHttpDependencies,
} from './transport/http/register-access-http.js'
