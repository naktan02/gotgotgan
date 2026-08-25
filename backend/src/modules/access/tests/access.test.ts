import { describe, expect, it } from 'vitest'

import {
  authorizeAndAudit,
  bootstrapInitialOwner,
  decideAccess,
  decideOwnershipChange,
  resolveAccessSubject,
  UnregisteredPrincipalError,
  MembershipAlreadyInitializedError,
  type AccessAuditEvent,
  type Membership,
  type MembershipDirectory,
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

describe('Place access policy', () => {
  it('allows anonymous access only to an explicit public projection', () => {
    expect(
      decideAccess(
        { kind: 'anonymous' },
        { permission: 'place.public.read', publicProjection: true },
      ),
    ).toMatchObject({ allowed: true, reason: 'public-projection' })
    expect(
      decideAccess({ kind: 'anonymous' }, { permission: 'library.read' }),
    ).toMatchObject({ allowed: false, reason: 'authentication-required' })
  })

  it.each([
    ['member', 'library.write', true],
    ['member', 'review.decide', false],
    ['reviewer', 'review.decide', true],
    ['reviewer', 'administration.manage', false],
    ['administrator', 'administration.manage', true],
    ['administrator', 'ownership.manage', false],
    ['owner', 'ownership.manage', true],
  ] as const)('%s requesting %s has allowed=%s', (role, permission, allowed) => {
    expect(
      decideAccess(
        { kind: 'member', membership: membership({ authorityRole: role }) },
        { permission },
      ).allowed,
    ).toBe(allowed)
  })

  it('does not turn a user grade or product tier into authority', () => {
    const decision = decideAccess(
      {
        kind: 'member',
        membership: membership({
          authorityRole: 'member',
          userGrade: 'administrator-community',
          productTier: 'enterprise-operator',
        }),
      },
      { permission: 'administration.manage' },
    )
    expect(decision).toMatchObject({ allowed: false, reason: 'permission-missing' })
  })

  it('allows only a matching explicit resource grant', () => {
    const subject = {
      kind: 'member' as const,
      membership: membership({
        resourceGrants: [
          { permission: 'review.decide', resource: { kind: 'review-queue', id: 'queue-a' } },
        ],
      }),
    }
    expect(
      decideAccess(subject, {
        permission: 'review.decide',
        resource: { kind: 'review-queue', id: 'queue-a' },
      }).allowed,
    ).toBe(true)
    expect(
      decideAccess(subject, {
        permission: 'review.decide',
        resource: { kind: 'review-queue', id: 'queue-b' },
      }).allowed,
    ).toBe(false)
  })

  it('denies all membership authority while suspended', () => {
    const decision = decideAccess(
      { kind: 'member', membership: membership({ authorityRole: 'owner', status: 'suspended' }) },
      { permission: 'ownership.manage' },
    )
    expect(decision).toMatchObject({ allowed: false, reason: 'membership-suspended' })
  })

  it('protects the last active owner from downgrade or suspension', () => {
    expect(
      decideOwnershipChange({
        activeOwnerCount: 1,
        targetCurrentRole: 'owner',
        targetNextRole: 'administrator',
      }),
    ).toEqual({ allowed: false, reason: 'last-owner-protected' })
    expect(
      decideOwnershipChange({
        activeOwnerCount: 2,
        targetCurrentRole: 'owner',
        suspendTarget: true,
      }).allowed,
    ).toBe(true)
  })
})

describe('principal resolution and audit', () => {
  it('does not downgrade a verified but unknown principal to anonymous', async () => {
    const directory: MembershipDirectory = { findByPrincipal: async () => undefined }
    await expect(resolveAccessSubject(principal, directory)).rejects.toBeInstanceOf(
      UnregisteredPrincipalError,
    )
  })

  it('records allow and denial decisions without token material', async () => {
    const events: AccessAuditEvent[] = []
    const decision = await authorizeAndAudit({
      subject: { kind: 'member', membership: membership({ authorityRole: 'reviewer' }) },
      request: { permission: 'administration.manage' },
      auditSink: { record: async (event) => void events.push(event) },
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })
    expect(decision.allowed).toBe(false)
    expect(events).toEqual([
      expect.objectContaining({
        occurredAt: '2026-08-25T12:00:00.000Z',
        subjectKind: 'member',
        decision: expect.objectContaining({ reason: 'permission-missing' }),
      }),
    ])
    expect(JSON.stringify(events)).not.toContain('token')
  })
})

describe('initial owner bootstrap', () => {
  it('requires verified operator authority and an atomic empty-membership store operation', async () => {
    const attempts: unknown[] = []
    const owner = await bootstrapInitialOwner({
      principal,
      userGrade: 'founding-member',
      productTier: 'standard',
      authority: { verify: async () => ({ operatorReference: 'operator-run-1' }) },
      store: {
        attemptAndAuditWhenNoMembershipExists: async (attempt) => {
          attempts.push(attempt)
          return 'created'
        },
      },
      nextMembershipId: () => 'membership-owner',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })
    expect(owner).toMatchObject({ authorityRole: 'owner', status: 'active' })
    expect(attempts).toEqual([
      expect.objectContaining({
        membership: expect.objectContaining({ id: 'membership-owner' }),
        operatorReference: 'operator-run-1',
      }),
    ])
  })

  it('rejects a second bootstrap through the atomic store contract', async () => {
    await expect(
      bootstrapInitialOwner({
        principal,
        userGrade: 'founding-member',
        productTier: 'standard',
        authority: { verify: async () => ({ operatorReference: 'operator-run-2' }) },
        store: { attemptAndAuditWhenNoMembershipExists: async () => 'already-initialized' },
        nextMembershipId: () => 'unused-membership',
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(MembershipAlreadyInitializedError)
  })
})
