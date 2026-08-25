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
      productTier: 'standard',
    })
    expect(response.body).not.toContain('subject-1')
    expect(response.body).not.toContain('verified-token')
  })
})
