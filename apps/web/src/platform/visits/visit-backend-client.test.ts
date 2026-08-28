import { describe, expect, it } from 'vitest'

import { createVisitBackendClient } from './visit-backend-client'

const placeId = '01992d20-0000-7000-8000-000000000001'
const visitId = '01992d20-0000-7000-8000-000000000002'

describe('Visit backend client', () => {
  it('uses only fixed authenticated Visit paths', async () => {
    const calls: Array<Readonly<{ url: string; init: RequestInit }>> = []
    const client = createVisitBackendClient({
      environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
      fetcher: async (input, init) => {
        calls.push({ url: input.toString(), init })
        return Response.json({})
      },
    })
    const signal = new AbortController().signal

    await client.history('server-token', placeId, {
      cursor: 'next/+', limit: 20,
    }, signal)
    await client.record('server-token', {
      id: visitId,
      placeId,
      visitedAt: '2026-08-28T01:30:00.000Z',
    }, signal)

    expect(calls.map((call) => call.url)).toEqual([
      `https://place-backend.example/v1/places/${placeId}/visits?limit=20&cursor=next%2F%2B`,
      'https://place-backend.example/v1/visits',
    ])
    expect(calls.every((call) => (
      new Headers(call.init.headers).get('authorization') === 'Bearer server-token'
    ))).toBe(true)
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      id: visitId,
      placeId,
      visitedAt: '2026-08-28T01:30:00.000Z',
    })
  })

  it('rejects an unbounded timeout', () => {
    expect(() => createVisitBackendClient({ timeoutMilliseconds: 60_001 }))
      .toThrow('Visit backend configuration is invalid')
  })
})
