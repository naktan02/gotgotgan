import type { Pool } from 'pg'

import type { InitialOwnerAttempt } from '../../../application/ports/initial-owner-store.js'
import type {
  MembershipOnboardingAttempt,
  MembershipOnboardingOutcome,
} from '../../../application/ports/membership-onboarding-store.js'
import {
  recordBootstrapAttempt,
  recordOnboardingAttempt,
} from './audit-writes.js'
import {
  insertMembership,
  lockMembershipByPrincipal,
} from './membership-records.js'
import { applyPlatformOwnerProjection } from './platform-owner-projection.js'

export async function attemptAndAuditOnboarding(
  pool: Pool,
  attempt: MembershipOnboardingAttempt,
): Promise<MembershipOnboardingOutcome> {
  const client = await pool.connect()
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
    let membership = await lockMembershipByPrincipal(
      client,
      attempt.membership.principal,
    )

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

export async function attemptAndAuditInitialOwner(
  pool: Pool,
  attempt: InitialOwnerAttempt,
): Promise<'created' | 'already-initialized'> {
  const client = await pool.connect()
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
