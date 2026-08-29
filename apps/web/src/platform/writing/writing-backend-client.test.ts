import { describe, expect, it } from 'vitest'

import { createWritingBackendClient } from './writing-backend-client'

const placeId = '01992d20-0000-7000-8000-000000000001'
const documentId = '01992d20-0000-7000-8000-000000000002'
const commandId = '01992d20-0000-7000-8000-000000000003'

describe('Writing backend client', () => {
  it('uses only fixed authenticated Writing paths', async () => {
    const calls: Array<Readonly<{ url: string; init: RequestInit }>> = []
    const client = createWritingBackendClient({
      environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
      fetcher: async (input, init) => {
        calls.push({ url: input.toString(), init })
        return Response.json({})
      },
    })
    const signal = new AbortController().signal

    await client.list('server-token', {
      kind: 'note', placeId, cursor: 'next/+', limit: 10,
    }, signal)
    await client.detail('server-token', documentId, signal)
    await client.command('server-token', {
      commandId,
      command: {
        kind: 'create-note', documentId, body: '국물이 깔끔했다.', placeId,
        visibility: 'private',
      },
    }, signal)

    expect(calls.map((call) => call.url)).toEqual([
      `https://place-backend.example/v1/writing?kind=note&limit=10&placeId=${placeId}&cursor=next%2F%2B`,
      `https://place-backend.example/v1/writing/${documentId}`,
      'https://place-backend.example/v1/writing/commands',
    ])
    expect(calls.every((call) => (
      new Headers(call.init.headers).get('authorization') === 'Bearer server-token'
    ))).toBe(true)
  })

  it('rejects an unbounded timeout', () => {
    expect(() => createWritingBackendClient({ timeoutMilliseconds: 60_001 }))
      .toThrow('Writing backend configuration is invalid')
  })
})
