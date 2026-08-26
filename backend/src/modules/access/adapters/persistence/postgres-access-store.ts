import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'

import {
  grantablePermissions,
  type ExternalPrincipal,
  type Membership,
  type ResourceGrant,
} from '../../domain/model.js'
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

const resourceGrantRowSchema = z.object({
  permission: z.enum(grantablePermissions),
  resourceKind: z.string(),
  resourceId: z.string().nullable(),
})
const membershipIdSchema = z.string().uuid()
const projectionRowSchema = z.object({
  membership_id: z.string().uuid().nullable(),
  previous_authority_role: z.enum(['member', 'reviewer', 'administrator']).nullable(),
  authority_revision: z.coerce.number().int().nonnegative(),
  owner_revision: z.coerce.number().int().nonnegative(),
})

const membershipRowSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  subject: z.string(),
  status: z.enum(['active', 'suspended']),
  authority_role: z.enum(['member', 'reviewer', 'administrator', 'owner']),
  user_grade: z.string(),
  product_tier: z.string(),
  resource_grants: z.array(resourceGrantRowSchema),
})

const membershipProjection = `
  SELECT
    memberships.id,
    memberships.issuer,
    memberships.subject,
    memberships.status,
    memberships.authority_role,
    memberships.user_grade,
    memberships.product_tier,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'permission', grants.permission,
            'resourceKind', grants.resource_kind,
            'resourceId', grants.resource_id
          )
          ORDER BY grants.permission, grants.resource_kind, grants.resource_id
        )
        FROM access.membership_resource_grants grants
        WHERE grants.membership_id = memberships.id
      ),
      '[]'::jsonb
    ) AS resource_grants
  FROM access.memberships memberships
`

function toMembership(row: unknown): Membership {
  const parsed = membershipRowSchema.parse(row)
  const resourceGrants: ResourceGrant[] = parsed.resource_grants.map((grant) => ({
    permission: grant.permission,
    resource: {
      kind: grant.resourceKind,
      ...(grant.resourceId === null ? {} : { id: grant.resourceId }),
    },
  }))
  return {
    id: parsed.id,
    principal: { issuer: parsed.issuer, subject: parsed.subject },
    status: parsed.status,
    authorityRole: parsed.authority_role,
    userGrade: parsed.user_grade,
    productTier: parsed.product_tier,
    resourceGrants,
  }
}

async function insertMembership(
  client: PoolClient,
  membership: Membership,
  occurredAt: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO access.memberships (
        id, issuer, subject, status, authority_role, user_grade, product_tier, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    `,
    [
      membership.id,
      membership.principal.issuer,
      membership.principal.subject,
      membership.status,
      membership.authorityRole,
      membership.userGrade,
      membership.productTier,
      occurredAt,
    ],
  )

  for (const grant of membership.resourceGrants) {
    await client.query(
      `
        INSERT INTO access.membership_resource_grants (
          membership_id, permission, resource_kind, resource_id
        )
        VALUES ($1, $2, $3, $4)
      `,
      [membership.id, grant.permission, grant.resource.kind, grant.resource.id ?? null],
    )
  }
}

async function recordOnboardingAttempt(
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

async function recordBootstrapAttempt(
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

async function recordRoleChangeAttempt(
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

async function recordPlatformOwnerProjection(
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

async function applyPlatformOwnerProjection(
  client: PoolClient,
  attempt: PlatformOwnerProjectionAttempt,
): Promise<PlatformOwnerProjectionOutcome> {
  const projectionResult = await client.query(
    `
      SELECT membership_id, previous_authority_role, authority_revision, owner_revision
      FROM access.platform_owner_projection
      WHERE singleton = true
      FOR UPDATE
    `,
  )
  const projection = projectionRowSchema.parse(projectionResult.rows[0])
  if (attempt.evidence.ownerRevision < projection.owner_revision) {
    await recordPlatformOwnerProjection(client, attempt, 'stale', null)
    return { status: 'stale' }
  }

  const claimsOwner = attempt.evidence.roles.includes('platform_owner')
  const targetResult = claimsOwner
    ? await client.query<{ id: string; authority_role: string }>(
        `
          SELECT id, authority_role
          FROM access.memberships
          WHERE issuer = $1 AND subject = $2
          FOR UPDATE
        `,
        [attempt.principal.issuer, attempt.principal.subject],
      )
    : undefined
  const target = targetResult?.rows[0]
  const newerOwnerRevision = attempt.evidence.ownerRevision > projection.owner_revision

  if (
    !newerOwnerRevision && claimsOwner && target !== undefined &&
    projection.membership_id !== null && projection.membership_id !== target.id
  ) {
    throw new Error('Platform owner assertion conflicts with the current owner revision.')
  }

  let nextMembershipId = projection.membership_id
  let nextPreviousRole = projection.previous_authority_role
  let changed = false

  if (newerOwnerRevision && nextMembershipId === null) {
    const legacyOwner = await client.query<{ id: string }>(
      `
        SELECT id
        FROM access.memberships
        WHERE authority_role = 'owner'
        FOR UPDATE
      `,
    )
    if (legacyOwner.rows[0] !== undefined) {
      nextMembershipId = legacyOwner.rows[0].id
      nextPreviousRole = 'member'
    }
  }

  if (newerOwnerRevision && nextMembershipId !== null) {
    await client.query(
      `
        UPDATE access.memberships
        SET authority_role = $1, updated_at = $2
        WHERE id = $3 AND authority_role = 'owner'
      `,
      [nextPreviousRole ?? 'member', attempt.occurredAt, nextMembershipId],
    )
    nextMembershipId = null
    nextPreviousRole = null
    changed = true
  }

  if (claimsOwner && target !== undefined && nextMembershipId === null) {
    const previousRole = target.authority_role === 'owner' ? 'member' : target.authority_role
    if (!['member', 'reviewer', 'administrator'].includes(previousRole)) {
      throw new Error('Platform owner target has an invalid local authority role.')
    }
    await client.query(
      `
        UPDATE access.memberships
        SET authority_role = 'owner', updated_at = $1
        WHERE id = $2
      `,
      [attempt.occurredAt, target.id],
    )
    nextMembershipId = target.id
    nextPreviousRole = previousRole as 'member' | 'reviewer' | 'administrator'
    changed = true
  }

  await client.query(
    `
      UPDATE access.platform_owner_projection
      SET
        membership_id = $1,
        previous_authority_role = $2,
        authority_revision = GREATEST(authority_revision, $3),
        owner_revision = GREATEST(owner_revision, $4),
        evidence_expires_at = $5,
        observed_at = $6
      WHERE singleton = true
    `,
    [
      nextMembershipId,
      nextPreviousRole,
      attempt.evidence.revision,
      attempt.evidence.ownerRevision,
      attempt.evidence.expiresAt,
      attempt.occurredAt,
    ],
  )

  const status = changed ? 'projected' : 'unchanged'
  await recordPlatformOwnerProjection(client, attempt, status, target?.id ?? null)
  const membershipResult = await client.query(
    `${membershipProjection}
     WHERE memberships.issuer = $1 AND memberships.subject = $2`,
    [attempt.principal.issuer, attempt.principal.subject],
  )
  return {
    status,
    ...(membershipResult.rows[0] === undefined
      ? {}
      : { membership: toMembership(membershipResult.rows[0]) }),
  }
}

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
    const result = await this.pool.query(
      `${membershipProjection} WHERE memberships.issuer = $1 AND memberships.subject = $2`,
      [principal.issuer, principal.subject],
    )
    return result.rows[0] === undefined ? undefined : toMembership(result.rows[0])
  }

  async findById(id: string): Promise<Membership | undefined> {
    if (!membershipIdSchema.safeParse(id).success) return undefined
    const result = await this.pool.query(
      `${membershipProjection} WHERE memberships.id = $1`,
      [id],
    )
    return result.rows[0] === undefined ? undefined : toMembership(result.rows[0])
  }

  async record(event: AccessAuditEvent): Promise<void> {
    const requestedTargetMembershipId =
      event.request.resource?.kind === 'membership'
        ? event.request.resource.id ?? null
        : null
    const targetMembershipId =
      requestedTargetMembershipId !== null &&
      membershipIdSchema.safeParse(requestedTargetMembershipId).success
        ? requestedTargetMembershipId
        : null
    await this.pool.query(
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

  async attemptAndAuditOnboarding(
    attempt: MembershipOnboardingAttempt,
  ): Promise<MembershipOnboardingOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        `
          INSERT INTO access.memberships (
            id,
            issuer,
            subject,
            status,
            authority_role,
            user_grade,
            product_tier,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'active', 'member', $4, $5, $6, $6)
          ON CONFLICT (issuer, subject) DO NOTHING
        `,
        [
          attempt.membership.id,
          attempt.membership.principal.issuer,
          attempt.membership.principal.subject,
          attempt.membership.userGrade,
          attempt.membership.productTier,
          attempt.occurredAt,
        ],
      )
      const selected = await client.query(
        `${membershipProjection}
         WHERE memberships.issuer = $1 AND memberships.subject = $2
         FOR UPDATE OF memberships`,
        [attempt.membership.principal.issuer, attempt.membership.principal.subject],
      )
      let membership = toMembership(selected.rows[0])

      for (const consent of attempt.consents) {
        await client.query(
          `
            INSERT INTO access.membership_consents (
              membership_id, document, version, accepted_at
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (membership_id, document, version) DO NOTHING
          `,
          [membership.id, consent.document, consent.version, attempt.occurredAt],
        )
      }

      if (attempt.platformEntitlement !== undefined) {
        const projection = await applyPlatformOwnerProjection(client, {
          principal: attempt.membership.principal,
          evidence: attempt.platformEntitlement,
          occurredAt: attempt.occurredAt,
        })
        membership = projection.membership ?? membership
      }

      const outcome: MembershipOnboardingOutcome = {
        status: inserted.rowCount === 1 ? 'created' : 'existing',
        membership,
      }
      await recordOnboardingAttempt(client, attempt, outcome)
      await client.query('COMMIT')
      return outcome
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async synchronizePlatformOwner(
    attempt: PlatformOwnerProjectionAttempt,
  ): Promise<PlatformOwnerProjectionOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const outcome = await applyPlatformOwnerProjection(client, attempt)
      await client.query('COMMIT')
      return outcome
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async attemptAndAuditWhenNoMembershipExists(
    attempt: InitialOwnerAttempt,
  ): Promise<'created' | 'already-initialized'> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('place.access.initial-owner-bootstrap.v1', 0))",
      )
      const existingMembership = await client.query('SELECT 1 FROM access.memberships LIMIT 1')
      if (existingMembership.rowCount !== 0) {
        await recordBootstrapAttempt(client, attempt, 'already-initialized')
        await client.query('COMMIT')
        return 'already-initialized'
      }

      await insertMembership(client, attempt.membership, attempt.occurredAt)
      await recordBootstrapAttempt(client, attempt, 'created')
      await client.query('COMMIT')
      return 'created'
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async attemptAndAuditRoleChange(
    attempt: AuthorityRoleChangeAttempt,
  ): Promise<'changed' | 'unchanged' | 'last-owner-protected' | 'centrally-managed' | 'conflict'> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      let activeOwnerCount: number | undefined
      if (attempt.expectedCurrentRole === 'owner' && attempt.nextRole !== 'owner') {
        const activeOwners = await client.query(
          `
            SELECT id
            FROM access.memberships
            WHERE status = 'active' AND authority_role = 'owner'
            ORDER BY id
            FOR UPDATE
          `,
        )
        activeOwnerCount = activeOwners.rowCount ?? 0
      }

      const targetResult = await client.query<{ authority_role: string; status: string }>(
        `
          SELECT authority_role, status
          FROM access.memberships
          WHERE id = $1
          FOR UPDATE
        `,
        [attempt.targetMembershipId],
      )
      const target = targetResult.rows[0]
      if (target === undefined || target.authority_role !== attempt.expectedCurrentRole) {
        await recordRoleChangeAttempt(client, attempt, 'conflict')
        await client.query('COMMIT')
        return 'conflict'
      }
      const platformOwner = await client.query(
        `
          SELECT 1
          FROM access.platform_owner_projection
          WHERE singleton = true AND membership_id = $1
        `,
        [attempt.targetMembershipId],
      )
      if (platformOwner.rowCount === 1) {
        await recordRoleChangeAttempt(client, attempt, 'centrally-managed')
        await client.query('COMMIT')
        return 'centrally-managed'
      }
      if (target.authority_role === attempt.nextRole) {
        await recordRoleChangeAttempt(client, attempt, 'unchanged')
        await client.query('COMMIT')
        return 'unchanged'
      }
      if (
        target.status === 'active' &&
        target.authority_role === 'owner' &&
        attempt.nextRole !== 'owner' &&
        (activeOwnerCount ?? 0) <= 1
      ) {
        await recordRoleChangeAttempt(client, attempt, 'last-owner-protected')
        await client.query('COMMIT')
        return 'last-owner-protected'
      }

      await client.query(
        `
          UPDATE access.memberships
          SET authority_role = $1, updated_at = $2
          WHERE id = $3
        `,
        [attempt.nextRole, attempt.occurredAt, attempt.targetMembershipId],
      )
      await recordRoleChangeAttempt(client, attempt, 'changed')
      await client.query('COMMIT')
      return 'changed'
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
