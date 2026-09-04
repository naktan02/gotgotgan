import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'

import {
  grantablePermissions,
  type ExternalPrincipal,
  type Membership,
  type ResourceGrant,
} from '../../../domain/model.js'

const resourceGrantRowSchema = z.object({
  permission: z.enum(grantablePermissions),
  resourceKind: z.string(),
  resourceId: z.string().nullable(),
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

const membershipIdSchema = z.string().uuid()

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

export function isMembershipId(value: string): boolean {
  return membershipIdSchema.safeParse(value).success
}

export async function findMembershipByPrincipal(
  database: Pool | PoolClient,
  principal: ExternalPrincipal,
): Promise<Membership | undefined> {
  const result = await database.query(
    `${membershipProjection} WHERE memberships.issuer = $1 AND memberships.subject = $2`,
    [principal.issuer, principal.subject],
  )
  return result.rows[0] === undefined ? undefined : toMembership(result.rows[0])
}

export async function lockMembershipByPrincipal(
  client: PoolClient,
  principal: ExternalPrincipal,
): Promise<Membership> {
  const result = await client.query(
    `${membershipProjection}
     WHERE memberships.issuer = $1 AND memberships.subject = $2
     FOR UPDATE OF memberships`,
    [principal.issuer, principal.subject],
  )
  return toMembership(result.rows[0])
}

export async function findMembershipById(
  pool: Pool,
  id: string,
): Promise<Membership | undefined> {
  if (!isMembershipId(id)) return undefined
  const result = await pool.query(
    `${membershipProjection} WHERE memberships.id = $1`,
    [id],
  )
  return result.rows[0] === undefined ? undefined : toMembership(result.rows[0])
}

export async function insertMembership(
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
