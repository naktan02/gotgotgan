import type { Pool, PoolClient } from 'pg'

import type { AccessAuditEvent } from '../../../application/ports/access-audit-sink.js'
import type { AuthorityRoleChangeAttempt } from '../../../application/ports/authority-role-change-store.js'
import type { InitialOwnerAttempt } from '../../../application/ports/initial-owner-store.js'
import type {
  MembershipOnboardingAttempt,
  MembershipOnboardingOutcome,
} from '../../../application/ports/membership-onboarding-store.js'
import type {
  PlatformOwnerProjectionAttempt,
  PlatformOwnerProjectionOutcome,
} from '../../../application/ports/platform-owner-projection-store.js'
import { isMembershipId } from './membership-records.js'

export async function recordAccessDecision(
  pool: Pool,
  event: AccessAuditEvent,
): Promise<void> {
  const requestedTargetMembershipId =
    event.request.resource?.kind === 'membership'
      ? event.request.resource.id ?? null
      : null
  const targetMembershipId =
    requestedTargetMembershipId !== null && isMembershipId(requestedTargetMembershipId)
      ? requestedTargetMembershipId
      : null
  await pool.query(
    `
      INSERT INTO access.audit_events (
        event_kind,
        occurred_at,
        actor_membership_id,
        target_membership_id,
        outcome,
        evidence
      )
      VALUES ('access-decision', $1, $2, $3, $4, $5)
    `,
    [
      event.occurredAt,
      event.decision.membershipId ?? null,
      targetMembershipId,
      event.decision.allowed ? 'allowed' : 'denied',
      event,
    ],
  )
}

export async function recordOnboardingAttempt(
  client: PoolClient,
  attempt: MembershipOnboardingAttempt,
  outcome: MembershipOnboardingOutcome,
): Promise<void> {
  await client.query(
    `
      INSERT INTO access.audit_events (
        event_kind,
        occurred_at,
        target_membership_id,
        outcome,
        evidence
      )
      VALUES ('membership-onboarding', $1, $2, $3, $4)
    `,
    [
      attempt.occurredAt,
      outcome.membership.id,
      outcome.status,
      { consents: attempt.consents },
    ],
  )
}

export async function recordBootstrapAttempt(
  client: PoolClient,
  attempt: InitialOwnerAttempt,
  outcome: 'created' | 'already-initialized',
): Promise<void> {
  await client.query(
    `
      INSERT INTO access.audit_events (
        event_kind,
        occurred_at,
        target_membership_id,
        outcome,
        evidence
      )
      VALUES ('initial-owner-bootstrap', $1, $2, $3, $4)
    `,
    [
      attempt.occurredAt,
      outcome === 'created' ? attempt.membership.id : null,
      outcome,
      { operatorReference: attempt.operatorReference },
    ],
  )
}

export async function recordRoleChangeAttempt(
  client: PoolClient,
  attempt: AuthorityRoleChangeAttempt,
  outcome: 'changed' | 'unchanged' | 'last-owner-protected' | 'centrally-managed' | 'conflict',
): Promise<void> {
  await client.query(
    `
      INSERT INTO access.audit_events (
        event_kind,
        occurred_at,
        actor_membership_id,
        target_membership_id,
        outcome,
        evidence
      )
      VALUES ('authority-role-change', $1, $2, $3, $4, $5)
    `,
    [
      attempt.occurredAt,
      attempt.actorMembershipId,
      attempt.targetMembershipId,
      outcome,
      {
        expectedCurrentRole: attempt.expectedCurrentRole,
        nextRole: attempt.nextRole,
      },
    ],
  )
}

export async function recordPlatformOwnerProjection(
  client: PoolClient,
  attempt: PlatformOwnerProjectionAttempt,
  outcome: PlatformOwnerProjectionOutcome['status'],
  targetMembershipId: string | null,
): Promise<void> {
  await client.query(
    `
      INSERT INTO access.audit_events (
        event_kind,
        occurred_at,
        target_membership_id,
        outcome,
        evidence
      )
      VALUES ('platform-owner-projection', $1, $2, $3, $4)
    `,
    [
      attempt.occurredAt,
      targetMembershipId,
      outcome,
      {
        roles: attempt.evidence.roles,
        authorityRevision: attempt.evidence.revision,
        ownerRevision: attempt.evidence.ownerRevision,
        expiresAt: attempt.evidence.expiresAt,
      },
    ],
  )
}
