import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'

import type {
  PlatformOwnerProjectionAttempt,
  PlatformOwnerProjectionOutcome,
} from '../../../application/ports/platform-owner-projection-store.js'
import { recordPlatformOwnerProjection } from './audit-writes.js'
import { findMembershipByPrincipal } from './membership-records.js'

const projectionRowSchema = z.object({
  membership_id: z.string().uuid().nullable(),
  previous_authority_role: z.enum(['member', 'reviewer', 'administrator']).nullable(),
  authority_revision: z.coerce.number().int().nonnegative(),
  owner_revision: z.coerce.number().int().nonnegative(),
})

export async function applyPlatformOwnerProjection(
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
  const membership = await findMembershipByPrincipal(client, attempt.principal)
  return {
    status,
    ...(membership === undefined ? {} : { membership }),
  }
}

export async function synchronizePlatformOwner(
  pool: Pool,
  attempt: PlatformOwnerProjectionAttempt,
): Promise<PlatformOwnerProjectionOutcome> {
  const client = await pool.connect()
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
