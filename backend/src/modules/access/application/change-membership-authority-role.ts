import type { AccessSubject, AuthorityRole } from '../domain/model.js'
import type { AccessAuditSink } from './ports/access-audit-sink.js'
import type { AuthorityRoleChangeStore } from './ports/authority-role-change-store.js'
import { authorizeAndAudit } from './resolve-access.js'

export type MembershipAuthorityRoleChange =
  | Readonly<{
      status: 'changed'
      targetMembershipId: string
      previousRole: AuthorityRole
      nextRole: AuthorityRole
    }>
  | Readonly<{ status: 'forbidden' }>
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'last-owner-protected'; targetMembershipId: string }>
  | Readonly<{ status: 'centrally-managed'; targetMembershipId: string }>
  | Readonly<{ status: 'conflict'; targetMembershipId: string }>
  | Readonly<{ status: 'unchanged'; targetMembershipId: string }>

export async function changeMembershipAuthorityRole(input: Readonly<{
  actor: AccessSubject
  targetMembershipId: string
  nextRole: AuthorityRole
  store: AuthorityRoleChangeStore
  auditSink: AccessAuditSink
  now: () => Date
}>): Promise<MembershipAuthorityRoleChange> {
  const target = await input.store.findById(input.targetMembershipId)
  const occurredAt = input.now()
  const permission =
    target?.authorityRole === 'owner' || input.nextRole === 'owner'
      ? 'ownership.manage'
      : 'administration.manage'
  const decision = await authorizeAndAudit({
    subject: input.actor,
    request: {
      permission,
      resource: { kind: 'membership', id: input.targetMembershipId },
    },
    auditSink: input.auditSink,
    now: () => occurredAt,
  })
  if (!decision.allowed || input.actor.kind !== 'member') {
    return { status: 'forbidden' }
  }
  if (target === undefined) return { status: 'not-found' }

  const outcome = await input.store.attemptAndAuditRoleChange({
    actorMembershipId: input.actor.membership.id,
    targetMembershipId: target.id,
    expectedCurrentRole: target.authorityRole,
    nextRole: input.nextRole,
    occurredAt: occurredAt.toISOString(),
  })
  if (outcome === 'last-owner-protected') {
    return { status: 'last-owner-protected', targetMembershipId: target.id }
  }
  if (outcome === 'centrally-managed') {
    return { status: 'centrally-managed', targetMembershipId: target.id }
  }
  if (outcome === 'conflict') return { status: 'conflict', targetMembershipId: target.id }
  if (outcome === 'unchanged') return { status: 'unchanged', targetMembershipId: target.id }
  return {
    status: 'changed',
    targetMembershipId: target.id,
    previousRole: target.authorityRole,
    nextRole: input.nextRole,
  }
}
