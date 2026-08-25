import { afterEach, describe, expect, it } from 'vitest'

import { buildHttpApplication } from '../src/entrypoints/http/app.js'

const applications = new Set<ReturnType<typeof buildHttpApplication>>()

afterEach(async () => {
  await Promise.all([...applications].map(async (application) => application.close()))
  applications.clear()
})

describe('GET /v1/me', () => {
  it('returns a stable 401 problem when bearer evidence is missing', async () => {
    const application = buildHttpApplication({
      access: {
        principalVerifier: {
          verify: async () => ({ issuer: 'https://identity.example', subject: 'subject-1' }),
        },
        membershipDirectory: { findByPrincipal: async () => undefined },
        auditSink: { record: async () => undefined },
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({ method: 'GET', url: '/v1/me' })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.json()).toMatchObject({
      type: 'urn:place:error:authentication-required',
      title: 'Authentication required',
      status: 401,
      code: 'PLACE_AUTHENTICATION_REQUIRED',
      retryable: false,
      correlationRef: expect.any(String),
    })
  })

  it('returns the same safe 401 problem when bearer evidence is invalid', async () => {
    const application = buildHttpApplication({
      access: {
        principalVerifier: { verify: async () => { throw new Error('sensitive verifier detail') } },
        membershipDirectory: { findByPrincipal: async () => undefined },
        auditSink: { record: async () => undefined },
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer invalid-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      code: 'PLACE_AUTHENTICATION_REQUIRED',
      status: 401,
    })
    expect(response.body).not.toContain('sensitive verifier detail')
    expect(response.body).not.toContain('invalid-token')
  })

  it('returns 403 when verified identity has no Place membership', async () => {
    const observedPrincipals: unknown[] = []
    const application = buildHttpApplication({
      access: {
        principalVerifier: {
          verify: async () => ({ issuer: 'https://identity.example', subject: 'subject-1' }),
        },
        membershipDirectory: {
          findByPrincipal: async (principal) => {
            observedPrincipals.push(principal)
            return undefined
          },
        },
        auditSink: { record: async () => undefined },
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer verified-token' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      type: 'urn:place:error:membership-required',
      code: 'PLACE_MEMBERSHIP_REQUIRED',
      status: 403,
      retryable: false,
    })
    expect(observedPrincipals).toEqual([
      { issuer: 'https://identity.example', subject: 'subject-1' },
    ])
  })

  it('returns an audited 403 when a suspended membership has no access', async () => {
    const audits: unknown[] = []
    const application = buildHttpApplication({
      access: {
        principalVerifier: {
          verify: async () => ({ issuer: 'https://identity.example', subject: 'subject-1' }),
        },
        membershipDirectory: {
          findByPrincipal: async (principal) => ({
            id: 'membership-1',
            principal,
            status: 'suspended',
            authorityRole: 'owner',
            userGrade: 'founding-member',
            productTier: 'standard',
            resourceGrants: [],
          }),
        },
        auditSink: { record: async (event) => void audits.push(event) },
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer verified-token' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      type: 'urn:place:error:access-denied',
      code: 'PLACE_ACCESS_DENIED',
      status: 403,
    })
    expect(audits).toEqual([
      expect.objectContaining({
        occurredAt: '2026-08-25T12:00:00.000Z',
        decision: expect.objectContaining({
          permission: 'library.read',
          reason: 'membership-suspended',
        }),
      }),
    ])
  })

  it('returns only the safe Place membership projection for an active member', async () => {
    const application = buildHttpApplication({
      access: {
        principalVerifier: {
          verify: async () => ({ issuer: 'https://identity.example', subject: 'subject-1' }),
        },
        membershipDirectory: {
          findByPrincipal: async (principal) => ({
            id: 'membership-1',
            principal,
            status: 'active',
            authorityRole: 'reviewer',
            userGrade: 'trusted-contributor',
            productTier: 'standard',
            resourceGrants: [],
          }),
        },
        auditSink: { record: async () => undefined },
        now: () => new Date('2026-08-25T12:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Bearer verified-token' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      membershipId: 'membership-1',
      authorityRole: 'reviewer',
      userGrade: 'trusted-contributor',
      productTier: 'standard',
    })
    expect(response.body).not.toContain('subject-1')
    expect(response.body).not.toContain('verified-token')
  })
})

type HttpApplicationOptions = NonNullable<Parameters<typeof buildHttpApplication>[0]>
type AccessDependencies = NonNullable<HttpApplicationOptions['access']>
type OnboardingDependencies = NonNullable<AccessDependencies['onboarding']>

function buildOnboardingApplication(input: Readonly<{
  store: OnboardingDependencies['store']
  requiredConsents?: OnboardingDependencies['policy']['requiredConsents']
  nextMembershipId?: () => string
}>): ReturnType<typeof buildHttpApplication> {
  const application = buildHttpApplication({
    access: {
      principalVerifier: {
        verify: async () => ({ issuer: 'https://identity.example', subject: 'subject-1' }),
      },
      membershipDirectory: { findByPrincipal: async () => undefined },
      auditSink: { record: async () => undefined },
      onboarding: {
        policy: {
          requiredConsents: input.requiredConsents ?? [
            { document: 'terms-of-service', version: '2026-08-26' },
          ],
          initialUserGrade: 'newcomer',
          initialProductTier: 'free',
        },
        store: input.store,
        nextMembershipId: input.nextMembershipId ?? (() => 'membership-1'),
      },
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  })
  applications.add(application)
  return application
}

describe('POST /v1/memberships/onboarding', () => {
  it('requires verified bearer evidence before membership onboarding', async () => {
    let storeCalled = false
    const application = buildOnboardingApplication({
      store: {
        attemptAndAuditOnboarding: async () => {
          storeCalled = true
          throw new Error('must not run')
        },
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      payload: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      },
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
    expect(response.json()).toMatchObject({
      code: 'PLACE_AUTHENTICATION_REQUIRED',
      status: 401,
      correlationRef: expect.any(String),
    })
    expect(storeCalled).toBe(false)
  })

  it('creates a non-elevated membership from verified evidence and current consent', async () => {
    const application = buildOnboardingApplication({
      requiredConsents: [
        { document: 'terms-of-service', version: '2026-08-26' },
        { document: 'privacy-policy', version: '2026-08-26' },
      ],
      store: {
        attemptAndAuditOnboarding: async (attempt) => ({
          status: 'created',
          membership: attempt.membership,
        }),
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer verified-token' },
      payload: {
        acceptedConsents: [
          { document: 'privacy-policy', version: '2026-08-26' },
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      status: 'created',
      membershipId: 'membership-1',
      authorityRole: 'member',
      userGrade: 'newcomer',
      productTier: 'free',
    })
    expect(response.body).not.toContain('subject-1')
    expect(response.body).not.toContain('verified-token')
  })

  it('rejects browser-supplied membership authority and identity fields', async () => {
    let storeCalled = false
    const application = buildOnboardingApplication({
      store: {
        attemptAndAuditOnboarding: async () => {
          storeCalled = true
          throw new Error('must not run')
        },
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer verified-token' },
      payload: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
        authorityRole: 'owner',
        principal: { issuer: 'https://attacker.example', subject: 'attacker' },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      code: 'PLACE_ONBOARDING_REQUEST_INVALID',
      status: 400,
      retryable: false,
      correlationRef: expect.any(String),
    })
    expect(response.body).not.toContain('owner')
    expect(response.body).not.toContain('attacker')
    expect(storeCalled).toBe(false)
  })

  it('returns the same safe invalid-request problem for malformed JSON', async () => {
    const application = buildOnboardingApplication({
      store: {
        attemptAndAuditOnboarding: async () => {
          throw new Error('must not run')
        },
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: {
        authorization: 'Bearer verified-token',
        'content-type': 'application/json',
      },
      payload: '{"acceptedConsents":',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      code: 'PLACE_ONBOARDING_REQUEST_INVALID',
      status: 400,
      correlationRef: expect.any(String),
    })
    expect(response.body).not.toContain('Unexpected')
  })

  it('returns a stable conflict when the accepted consent set is stale', async () => {
    let storeCalled = false
    const application = buildOnboardingApplication({
      requiredConsents: [
        { document: 'terms-of-service', version: '2026-08-26' },
        { document: 'privacy-policy', version: '2026-08-26' },
      ],
      store: {
        attemptAndAuditOnboarding: async () => {
          storeCalled = true
          throw new Error('must not run')
        },
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer verified-token' },
      payload: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-25' },
        ],
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      type: 'urn:place:error:membership-consent-required',
      code: 'PLACE_MEMBERSHIP_CONSENT_REQUIRED',
      status: 409,
      retryable: true,
      correlationRef: expect.any(String),
    })
    expect(storeCalled).toBe(false)
  })

  it('returns the existing membership without replacing any membership axis', async () => {
    const application = buildOnboardingApplication({
      nextMembershipId: () => 'membership-unused',
      store: {
        attemptAndAuditOnboarding: async (attempt) => ({
          status: 'existing',
          membership: {
            ...attempt.membership,
            id: 'membership-existing',
            status: 'suspended',
            authorityRole: 'owner',
            userGrade: 'founding-member',
            productTier: 'sponsor',
          },
        }),
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer verified-token' },
      payload: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'existing',
      membershipId: 'membership-existing',
      authorityRole: 'owner',
      userGrade: 'founding-member',
      productTier: 'sponsor',
    })
  })

  it('sanitizes onboarding persistence failures as a retryable unavailable problem', async () => {
    const application = buildOnboardingApplication({
      store: {
        attemptAndAuditOnboarding: async () => {
          throw new Error('database-password at internal.database.example')
        },
      },
    })

    const response = await application.inject({
      method: 'POST',
      url: '/v1/memberships/onboarding',
      headers: { authorization: 'Bearer verified-token' },
      payload: {
        acceptedConsents: [
          { document: 'terms-of-service', version: '2026-08-26' },
        ],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.json()).toMatchObject({
      code: 'PLACE_MEMBERSHIP_ONBOARDING_UNAVAILABLE',
      status: 503,
      retryable: true,
      correlationRef: expect.any(String),
    })
    expect(response.body).not.toContain('database-password')
    expect(response.body).not.toContain('internal.database.example')
  })
})

describe('membership consent and authority management HTTP', () => {
  it('publishes only the server-selected current consent documents', async () => {
    const application = buildOnboardingApplication({
      requiredConsents: [
        { document: 'terms-of-service', version: '2026-08-26' },
        { document: 'privacy-policy', version: '2026-08-26' },
      ],
      store: {
        attemptAndAuditOnboarding: async () => {
          throw new Error('must not run')
        },
      },
    })

    const response = await application.inject({
      method: 'GET',
      url: '/v1/membership-consents/current',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      consents: [
        { document: 'terms-of-service', version: '2026-08-26' },
        { document: 'privacy-policy', version: '2026-08-26' },
      ],
    })
    expect(response.body).not.toContain('newcomer')
    expect(response.body).not.toContain('free')
  })

  it('maps an audited administrator role change to a safe result', async () => {
    const actorId = '11111111-1111-4111-8111-111111111111'
    const targetId = '22222222-2222-4222-8222-222222222222'
    const principal = { issuer: 'https://identity.example', subject: 'administrator' }
    const application = buildHttpApplication({
      access: {
        principalVerifier: { verify: async () => principal },
        membershipDirectory: {
          findByPrincipal: async () => ({
            id: actorId,
            principal,
            status: 'active',
            authorityRole: 'administrator',
            userGrade: 'regular',
            productTier: 'standard',
            resourceGrants: [],
          }),
        },
        auditSink: { record: async () => undefined },
        authorityManagement: {
          store: {
            findById: async () => ({
              id: targetId,
              principal: { issuer: 'https://identity.example', subject: 'reviewer' },
              status: 'active',
              authorityRole: 'reviewer',
              userGrade: 'regular',
              productTier: 'standard',
              resourceGrants: [],
            }),
            attemptAndAuditRoleChange: async () => 'changed',
          },
        },
        now: () => new Date('2026-08-26T00:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'PATCH',
      url: `/v1/administration/memberships/${targetId}/authority-role`,
      headers: { authorization: 'Bearer administrator-token' },
      payload: { nextRole: 'member' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'changed',
      membershipId: targetId,
      previousRole: 'reviewer',
      authorityRole: 'member',
    })
    expect(response.body).not.toContain('administrator-token')
    expect(response.body).not.toContain('subject')
  })

  it('does not disclose target existence to a caller without management authority', async () => {
    const principal = { issuer: 'https://identity.example', subject: 'member' }
    const application = buildHttpApplication({
      access: {
        principalVerifier: { verify: async () => principal },
        membershipDirectory: {
          findByPrincipal: async () => ({
            id: '11111111-1111-4111-8111-111111111111',
            principal,
            status: 'active',
            authorityRole: 'member',
            userGrade: 'regular',
            productTier: 'standard',
            resourceGrants: [],
          }),
        },
        auditSink: { record: async () => undefined },
        authorityManagement: {
          store: {
            findById: async () => undefined,
            attemptAndAuditRoleChange: async () => {
              throw new Error('must not run')
            },
          },
        },
        now: () => new Date('2026-08-26T00:00:00.000Z'),
      },
    })
    applications.add(application)

    const response = await application.inject({
      method: 'PATCH',
      url: '/v1/administration/memberships/33333333-3333-4333-8333-333333333333/authority-role',
      headers: { authorization: 'Bearer member-token' },
      payload: { nextRole: 'reviewer' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      code: 'PLACE_ACCESS_DENIED',
      status: 403,
      correlationRef: expect.any(String),
    })
    expect(response.body).not.toContain('not-found')
  })
})
