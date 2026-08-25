import { describe, expect, it } from 'vitest'

import { createMembershipBackendClient } from './membership-backend-client'

describe('membership backend client', () => {
  it('uses fixed backend paths and sends bearer evidence only on onboarding', async () => {
    const requests: Request[] = []
    const client = createMembershipBackendClient({
      origin: 'https://place-backend.example',
      timeoutMilliseconds: 5_000,
      request: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({})
      },
    })

    await client.ready()
    await client.currentConsents()
    await client.onboard('server-side-token', {
      acceptedConsents: [{ document: 'terms-of-service', version: '2026-08-26' }],
    })

    expect(requests.map((request) => request.url)).toEqual([
      'https://place-backend.example/readyz',
      'https://place-backend.example/v1/membership-consents/current',
      'https://place-backend.example/v1/memberships/onboarding',
    ])
    expect(requests[0]?.headers.get('authorization')).toBeNull()
    expect(requests[1]?.headers.get('authorization')).toBeNull()
    expect(requests[2]?.headers.get('authorization')).toBe(
      'Bearer server-side-token',
    )
    expect(requests.every((request) => request.redirect === 'error')).toBe(true)
  })

  it('rejects origins that could redirect or embed credentials and unbounded timeouts', () => {
    for (const config of [
      { origin: 'https://user:secret@place-backend.example', timeoutMilliseconds: 5_000 },
      { origin: 'https://place-backend.example/internal', timeoutMilliseconds: 5_000 },
      { origin: 'https://place-backend.example', timeoutMilliseconds: 60_001 },
    ]) {
      expect(() => createMembershipBackendClient(config)).toThrow(
        'Membership backend configuration is invalid',
      )
    }
  })
})
