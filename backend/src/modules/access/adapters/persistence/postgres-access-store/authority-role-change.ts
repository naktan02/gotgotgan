import type { Pool } from 'pg'

import type { AuthorityRoleChangeAttempt } from '../../../application/ports/authority-role-change-store.js'
import { recordRoleChangeAttempt } from './audit-writes.js'

export type AuthorityRoleChangeOutcome =
  | 'changed'
  | 'unchanged'
  | 'last-owner-protected'
  | 'centrally-managed'
  | 'conflict'

export async function attemptAndAuditRoleChange(
  pool: Pool,
  attempt: AuthorityRoleChangeAttempt,
): Promise<AuthorityRoleChangeOutcome> {
  const client = await pool.connect()
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
