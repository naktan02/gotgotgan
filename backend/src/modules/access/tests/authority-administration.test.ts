import { describe, expect, it } from 'vitest'

import {
  changeMembershipAuthorityRole,
  type AccessAuditEvent,
  type Membership,
} from '../index.js'

const principal = { issuer: 'https://issuer.example', subject: 'subject-1' }

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'membership-1',
    principal,
    status: 'active',
    authorityRole: 'member',
    userGrade: 'regular',
    productTier: 'standard',
    resourceGrants: [],
    ...overrides,
  }
}

describe('membership authority administration', () => {
  it('lets an administrator change a non-owner role through one audited atomic store attempt', async () => {
    const audits: AccessAuditEvent[] = []
    const attempts: unknown[] = []
    const actor = membership({ id: 'administrator-1', authorityRole: 'administrator' })
    const target = membership({ id: 'reviewer-1', authorityRole: 'reviewer' })

    const result = await changeMembershipAuthorityRole({
      actor: { kind: 'member', membership: actor },
      targetMembershipId: target.id,
      nextRole: 'member',
      store: {
        findById: async (id) => id === target.id ? target : undefined,
        attemptAndAuditRoleChange: async (attempt) => {
          attempts.push(attempt)
          return 'changed'
        },
      },
      auditSink: { record: async (event) => void audits.push(event) },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'changed',
      targetMembershipId: 'reviewer-1',
      previousRole: 'reviewer',
      nextRole: 'member',
    })
    expect(audits).toEqual([
      expect.objectContaining({
        decision: expect.objectContaining({
          allowed: true,
          permission: 'administration.manage',
        }),
      }),
    ])
    expect(attempts).toEqual([
      {
        actorMembershipId: 'administrator-1',
        targetMembershipId: 'reviewer-1',
        expectedCurrentRole: 'reviewer',
        nextRole: 'member',
        occurredAt: '2026-08-25T12:00:00.000Z',
      },
    ])
  })

  it('requires owner authority when changing a current owner', async () => {
    const audits: AccessAuditEvent[] = []
    let attempted = false
    const result = await changeMembershipAuthorityRole({
      actor: {
        kind: 'member',
        membership: membership({ id: 'administrator-1', authorityRole: 'administrator' }),
      },
      targetMembershipId: 'owner-1',
      nextRole: 'administrator',
      store: {
        findById: async () => membership({ id: 'owner-1', authorityRole: 'owner' }),
        attemptAndAuditRoleChange: async () => {
          attempted = true
          return 'changed'
        },
      },
      auditSink: { record: async (event) => void audits.push(event) },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({ status: 'forbidden' })
    expect(attempted).toBe(false)
    expect(audits).toEqual([
      expect.objectContaining({
        decision: expect.objectContaining({
          allowed: false,
          permission: 'ownership.manage',
        }),
      }),
    ])
  })

  it('reports last-owner protection from the atomic store without claiming a change', async () => {
    const result = await changeMembershipAuthorityRole({
      actor: {
        kind: 'member',
        membership: membership({ id: 'owner-1', authorityRole: 'owner' }),
      },
      targetMembershipId: 'owner-1',
      nextRole: 'administrator',
      store: {
        findById: async () => membership({ id: 'owner-1', authorityRole: 'owner' }),
        attemptAndAuditRoleChange: async () => 'last-owner-protected',
      },
      auditSink: { record: async () => undefined },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'last-owner-protected',
      targetMembershipId: 'owner-1',
    })
  })

  it('does not reveal whether a membership exists to an unauthorized actor', async () => {
    const audits: AccessAuditEvent[] = []
    const result = await changeMembershipAuthorityRole({
      actor: { kind: 'member', membership: membership({ authorityRole: 'member' }) },
      targetMembershipId: 'unknown-membership',
      nextRole: 'reviewer',
      store: {
        findById: async () => undefined,
        attemptAndAuditRoleChange: async () => {
          throw new Error('must not run')
        },
      },
      auditSink: { record: async (event) => void audits.push(event) },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({ status: 'forbidden' })
    expect(audits).toEqual([
      expect.objectContaining({
        decision: expect.objectContaining({
          allowed: false,
          permission: 'administration.manage',
        }),
      }),
    ])
  })

  it('surfaces an atomic-store conflict instead of overwriting a concurrent role change', async () => {
    const result = await changeMembershipAuthorityRole({
      actor: {
        kind: 'member',
        membership: membership({ id: 'owner-1', authorityRole: 'owner' }),
      },
      targetMembershipId: 'reviewer-1',
      nextRole: 'administrator',
      store: {
        findById: async () => membership({ id: 'reviewer-1', authorityRole: 'reviewer' }),
        attemptAndAuditRoleChange: async () => 'conflict',
      },
      auditSink: { record: async () => undefined },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({ status: 'conflict', targetMembershipId: 'reviewer-1' })
  })

  it('reports an audited no-op when the requested role is already current', async () => {
    const attempts: unknown[] = []
    const result = await changeMembershipAuthorityRole({
      actor: {
        kind: 'member',
        membership: membership({ id: 'administrator-1', authorityRole: 'administrator' }),
      },
      targetMembershipId: 'reviewer-1',
      nextRole: 'reviewer',
      store: {
        findById: async () => membership({ id: 'reviewer-1', authorityRole: 'reviewer' }),
        attemptAndAuditRoleChange: async (attempt) => {
          attempts.push(attempt)
          return 'unchanged'
        },
      },
      auditSink: { record: async () => undefined },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({ status: 'unchanged', targetMembershipId: 'reviewer-1' })
    expect(attempts).toHaveLength(1)
  })
})
