import type {
  AccessSubject,
  AuthorityRole,
  Membership,
  PlacePermission,
  ResourceScope,
} from './model.js'

const permissionsByRole: Readonly<Record<AuthorityRole, ReadonlySet<PlacePermission>>> = {
  member: new Set([
    'place.public.read', 'search.read', 'library.read', 'library.write', 'library.share',
    'imports.read', 'imports.write', 'profiles.report',
  ]),
  reviewer: new Set([
    'place.public.read',
    'search.read',
    'library.read',
    'library.write',
    'library.share',
    'imports.read',
    'imports.write',
    'review.read',
    'review.decide',
    'profiles.report',
    'profiles.moderate',
  ]),
  administrator: new Set([
    'place.public.read',
    'search.read',
    'library.read',
    'library.write',
    'library.share',
    'imports.read',
    'imports.write',
    'review.read',
    'review.decide',
    'profiles.report',
    'profiles.moderate',
    'administration.read',
    'administration.manage',
  ]),
  owner: new Set([
    'place.public.read',
    'search.read',
    'library.read',
    'library.write',
    'library.share',
    'imports.read',
    'imports.write',
    'review.read',
    'review.decide',
    'profiles.report',
    'profiles.moderate',
    'administration.read',
    'administration.manage',
    'ownership.manage',
  ]),
}

export type AccessRequest = Readonly<{
  permission: PlacePermission
  resource?: ResourceScope
  publicProjection?: boolean
}>

export type AccessDecisionReason =
  | 'public-projection'
  | 'role'
  | 'resource-grant'
  | 'authentication-required'
  | 'membership-suspended'
  | 'permission-missing'

export type AccessDecision = Readonly<{
  allowed: boolean
  reason: AccessDecisionReason
  membershipId?: string
  authorityRole?: AuthorityRole
  permission: PlacePermission
  resource?: ResourceScope
}>

function resourceMatches(grant: ResourceScope, requested: ResourceScope): boolean {
  return grant.kind === requested.kind && (grant.id === undefined || grant.id === requested.id)
}

function memberDecision(membership: Membership, request: AccessRequest): AccessDecision {
  const evidence = {
    membershipId: membership.id,
    authorityRole: membership.authorityRole,
    permission: request.permission,
    ...(request.resource === undefined ? {} : { resource: request.resource }),
  }

  if (membership.status !== 'active') {
    return { allowed: false, reason: 'membership-suspended', ...evidence }
  }

  if (permissionsByRole[membership.authorityRole].has(request.permission)) {
    return { allowed: true, reason: 'role', ...evidence }
  }

  if (
    request.resource !== undefined &&
    membership.resourceGrants.some(
      (grant) =>
        grant.permission === request.permission && resourceMatches(grant.resource, request.resource!),
    )
  ) {
    return { allowed: true, reason: 'resource-grant', ...evidence }
  }

  return { allowed: false, reason: 'permission-missing', ...evidence }
}

export function decideAccess(subject: AccessSubject, request: AccessRequest): AccessDecision {
  if (subject.kind === 'anonymous') {
    if (request.permission === 'place.public.read' && request.publicProjection === true) {
      return { allowed: true, reason: 'public-projection', permission: request.permission }
    }
    return { allowed: false, reason: 'authentication-required', permission: request.permission }
  }

  return memberDecision(subject.membership, request)
}
