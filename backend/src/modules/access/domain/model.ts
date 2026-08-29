export const authorityRoles = ['member', 'reviewer', 'administrator', 'owner'] as const
export type AuthorityRole = (typeof authorityRoles)[number]

export const membershipStatuses = ['active', 'suspended'] as const
export type MembershipStatus = (typeof membershipStatuses)[number]

export type UserGrade = string
export type ProductTier = string

export const grantablePermissions = [
  'search.read',
  'library.read',
  'library.write',
  'library.share',
  'imports.read',
  'imports.write',
  'review.read',
  'review.decide',
] as const
export type GrantablePermission = (typeof grantablePermissions)[number]

export const placePermissions = [
  'place.public.read',
  ...grantablePermissions,
  'profiles.report',
  'profiles.appeal',
  'profiles.moderate',
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

export type ResourceGrant = Readonly<{
  permission: GrantablePermission
  resource: ResourceScope
}>

export type Membership = Readonly<{
  id: string
  principal: ExternalPrincipal
  status: MembershipStatus
  authorityRole: AuthorityRole
  userGrade: UserGrade
  productTier: ProductTier
  resourceGrants: readonly ResourceGrant[]
}>

export type MembershipConsent = Readonly<{
  document: string
  version: string
}>

export type AccessSubject =
  | Readonly<{ kind: 'anonymous' }>
  | Readonly<{ kind: 'member'; membership: Membership }>

export function externalPrincipalKey(principal: ExternalPrincipal): string {
  return `${principal.issuer.length}:${principal.issuer}${principal.subject.length}:${principal.subject}`
}
