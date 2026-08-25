import { describe, expect, it } from 'vitest'

import {
  completeMembershipOnboarding,
  MembershipConsentRequiredError,
  type Membership,
  type MembershipOnboardingAttempt,
} from '../index.js'

const principal = { issuer: 'https://issuer.example', subject: 'subject-1' }
const requiredConsents = [
  { document: 'terms-of-service', version: '2026-08-25' },
  { document: 'privacy-policy', version: '2026-08-25' },
] as const

describe('membership onboarding', () => {
  it('creates a non-elevated membership only after the current consent set is accepted', async () => {
    const attempts: MembershipOnboardingAttempt[] = []

    const result = await completeMembershipOnboarding({
      principal,
      acceptedConsents: requiredConsents,
      policy: {
        requiredConsents,
        initialUserGrade: 'newcomer',
        initialProductTier: 'free',
      },
      store: {
        attemptAndAuditOnboarding: async (attempt) => {
          attempts.push(attempt)
          return { status: 'created', membership: attempt.membership }
        },
      },
      nextMembershipId: () => 'membership-1',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({
      status: 'created',
      membership: {
        id: 'membership-1',
        principal,
        status: 'active',
        authorityRole: 'member',
        userGrade: 'newcomer',
        productTier: 'free',
        resourceGrants: [],
      },
    })
    expect(attempts).toEqual([
      {
        membership: result.membership,
        consents: requiredConsents,
        occurredAt: '2026-08-25T12:00:00.000Z',
      },
    ])
  })

  it('rejects a stale or partial consent set before calling persistence', async () => {
    let storeCalled = false

    await expect(
      completeMembershipOnboarding({
        principal,
        acceptedConsents: [{ document: 'terms-of-service', version: 'outdated' }],
        policy: {
          requiredConsents,
          initialUserGrade: 'newcomer',
          initialProductTier: 'free',
        },
        store: {
          attemptAndAuditOnboarding: async () => {
            storeCalled = true
            throw new Error('must not run')
          },
        },
        nextMembershipId: () => 'unused-membership',
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(MembershipConsentRequiredError)
    expect(storeCalled).toBe(false)
  })

  it('preserves every existing membership axis on an idempotent retry', async () => {
    const existing: Membership = {
      id: 'membership-existing',
      principal,
      status: 'suspended',
      authorityRole: 'owner',
      userGrade: 'founding-member',
      productTier: 'sponsor',
      resourceGrants: [],
    }

    const result = await completeMembershipOnboarding({
      principal,
      acceptedConsents: requiredConsents,
      policy: {
        requiredConsents,
        initialUserGrade: 'newcomer',
        initialProductTier: 'free',
      },
      store: {
        attemptAndAuditOnboarding: async () => ({
          status: 'existing',
          membership: existing,
        }),
      },
      nextMembershipId: () => 'membership-new-attempt',
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    })

    expect(result).toEqual({ status: 'existing', membership: existing })
  })
})
