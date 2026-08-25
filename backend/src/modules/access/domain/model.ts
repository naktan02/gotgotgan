export const authorityRoles = ['member', 'reviewer', 'administrator', 'owner'] as const
export type AuthorityRole = (typeof authorityRoles)[number]

export const membershipStatuses = ['active', 'suspended'] as const
export type MembershipStatus = (typeof membershipStatuses)[number]

export const placePermissions = [
  'place.public.read',
  'library.read',
  'library.write',
  'review.read',
  'review.decide',
  'administration.read',
  'administration.manage',
  'ownership.manage',
] as const
export type PlacePermission = (typeof placePermissions)[number]

export type ExternalPrincipal = Readonly<{
  issuer: string
  subject: string
}>

export type ResourceScope = Readonly<{
  kind: string
  id?: string
}>

export type GrantablePermission = Extract<
  PlacePermission,
  'library.read' | 'library.write' | 'review.read' | 'review.decide'
>

export type ResourceGrant = Readonly<{
  permission: GrantablePermission
  resource: ResourceScope
}>

export type Membership = Readonly<{
  id: string
  principal: ExternalPrincipal
  status: MembershipStatus
  authorityRole: AuthorityRole
  productTier: string
  resourceGrants: readonly ResourceGrant[]
}>

export type AccessSubject =
  | Readonly<{ kind: 'anonymous' }>
  | Readonly<{ kind: 'member'; membership: Membership }>

export function externalPrincipalKey(principal: ExternalPrincipal): string {
  return `${principal.issuer.length}:${principal.issuer}${principal.subject.length}:${principal.subject}`
}
