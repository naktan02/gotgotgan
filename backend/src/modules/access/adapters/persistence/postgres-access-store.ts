import type { Pool } from 'pg'

import type { AccessAuditEvent, AccessAuditSink } from '../../application/ports/access-audit-sink.js'
import type {
  AuthorityRoleChangeAttempt,
  AuthorityRoleChangeStore,
} from '../../application/ports/authority-role-change-store.js'
import type { InitialOwnerAttempt, InitialOwnerStore } from '../../application/ports/initial-owner-store.js'
import type { MembershipDirectory } from '../../application/ports/membership-directory.js'
import type {
  MembershipOnboardingAttempt,
  MembershipOnboardingOutcome,
  MembershipOnboardingStore,
} from '../../application/ports/membership-onboarding-store.js'
import type {
  PlatformOwnerProjectionAttempt,
  PlatformOwnerProjectionOutcome,
  PlatformOwnerProjectionStore,
} from '../../application/ports/platform-owner-projection-store.js'
import type { ExternalPrincipal, Membership } from '../../domain/model.js'
import { recordAccessDecision } from './postgres-access-store/audit-writes.js'
import {
  attemptAndAuditRoleChange,
  type AuthorityRoleChangeOutcome,
} from './postgres-access-store/authority-role-change.js'
import {
  attemptAndAuditInitialOwner,
  attemptAndAuditOnboarding,
} from './postgres-access-store/membership-creation.js'
import {
  findMembershipById,
  findMembershipByPrincipal,
} from './postgres-access-store/membership-records.js'
import { synchronizePlatformOwner } from './postgres-access-store/platform-owner-projection.js'

export class PostgresAccessStore
  implements
    MembershipDirectory,
    MembershipOnboardingStore,
    InitialOwnerStore,
    AuthorityRoleChangeStore,
    PlatformOwnerProjectionStore,
    AccessAuditSink {
  constructor(private readonly pool: Pool) {}

  async findByPrincipal(principal: ExternalPrincipal): Promise<Membership | undefined> {
    return findMembershipByPrincipal(this.pool, principal)
  }

  async findById(id: string): Promise<Membership | undefined> {
    return findMembershipById(this.pool, id)
  }

  async record(event: AccessAuditEvent): Promise<void> {
    return recordAccessDecision(this.pool, event)
  }

  async attemptAndAuditOnboarding(
    attempt: MembershipOnboardingAttempt,
  ): Promise<MembershipOnboardingOutcome> {
    return attemptAndAuditOnboarding(this.pool, attempt)
  }

  async synchronizePlatformOwner(
    attempt: PlatformOwnerProjectionAttempt,
  ): Promise<PlatformOwnerProjectionOutcome> {
    return synchronizePlatformOwner(this.pool, attempt)
  }

  async attemptAndAuditWhenNoMembershipExists(
    attempt: InitialOwnerAttempt,
  ): Promise<'created' | 'already-initialized'> {
    return attemptAndAuditInitialOwner(this.pool, attempt)
  }

  async attemptAndAuditRoleChange(
    attempt: AuthorityRoleChangeAttempt,
  ): Promise<AuthorityRoleChangeOutcome> {
    return attemptAndAuditRoleChange(this.pool, attempt)
  }
}
