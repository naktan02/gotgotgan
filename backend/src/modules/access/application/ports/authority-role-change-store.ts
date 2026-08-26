import type { AuthorityRole, Membership } from '../../domain/model.js'

export type AuthorityRoleChangeAttempt = Readonly<{
  actorMembershipId: string
  targetMembershipId: string
  expectedCurrentRole: AuthorityRole
  nextRole: AuthorityRole
  occurredAt: string
}>

export interface AuthorityRoleChangeStore {
  findById(id: string): Promise<Membership | undefined>
  /**
   * Compares the expected role, protects the final active owner, applies the change, and records
   * the attempt in one transaction. A conflict never overwrites the newer membership state.
   */
  attemptAndAuditRoleChange(
    attempt: AuthorityRoleChangeAttempt,
  ): Promise<'changed' | 'unchanged' | 'last-owner-protected' | 'centrally-managed' | 'conflict'>
}
