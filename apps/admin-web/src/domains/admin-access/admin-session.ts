export const adminAuthorityRoles = ['reviewer', 'administrator', 'owner'] as const

export type AdminAuthorityRole = (typeof adminAuthorityRoles)[number]

export type AdminSession = Readonly<{
  schemaVersion: 'place-admin-session.v1'
  authorityRole: AdminAuthorityRole
  userGrade: string
  productTier: string
}>

export type AdminAccessState =
  | Readonly<{ kind: 'checking' }>
  | Readonly<{ kind: 'ready'; session: AdminSession }>
  | Readonly<{ kind: 'unauthenticated' }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'unavailable' }>

export function isAdminSession(value: unknown): value is AdminSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.schemaVersion === 'place-admin-session.v1' &&
    typeof candidate.authorityRole === 'string' &&
    adminAuthorityRoles.includes(candidate.authorityRole as AdminAuthorityRole) &&
    typeof candidate.userGrade === 'string' && candidate.userGrade.length > 0 &&
    typeof candidate.productTier === 'string' && candidate.productTier.length > 0 &&
    Object.keys(candidate).every((key) =>
      ['schemaVersion', 'authorityRole', 'userGrade', 'productTier'].includes(key),
    )
}
