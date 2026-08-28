import { describe, expect, it } from 'vitest'

import { createLibraryBackendClient } from './library-backend-client'

const collectionId = '01992d20-0000-7000-8000-000000000001'
const placeId = '01992d20-0000-7000-8000-000000000002'
const tagA = '01992d20-0000-7000-8000-000000000003'
const tagB = '01992d20-0000-7000-8000-000000000004'
const areaKey = 'area_abcdefghijklmnopqrstuv'

describe('library backend client', () => {
  it('uses only fixed authenticated Library and Place paths', async () => {
    const calls: Array<Readonly<{ url: string; init: RequestInit }>> = []
    const client = createLibraryBackendClient({
      environment: { PLACE_BACKEND_ORIGIN: 'https://place-backend.example' },
      fetcher: async (input, init) => {
        calls.push({ url: input.toString(), init })
        return Response.json({})
      },
    })
    const signal = new AbortController().signal

    await client.places('server-token', {
      state: 'wanted', tagIds: [tagA, tagB], tagMatch: 'any',
      areaKeys: [areaKey], taxonomyKeys: ['food.noodle.ramen'],
      cursor: 'next/+', limit: 25,
    }, signal)
    await client.facets('server-token', signal)
    await client.organization('server-token', placeId, { cursor: 'organization-2', limit: 50 }, signal)
    await client.collections('server-token', { limit: 50 }, signal)
    await client.collection('server-token', collectionId, { cursor: 'page-2', limit: 20 }, signal)
    await client.tags('server-token', { limit: 50 }, signal)
    await client.command('server-token', { commandId: collectionId }, signal)
    await client.place('server-token', placeId, signal)

    expect(calls.map((call) => call.url)).toEqual([
      `https://place-backend.example/v1/library/places?limit=25&cursor=next%2F%2B&state=wanted&tagMatch=any&tagIds=${tagA}&tagIds=${tagB}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen`,
      'https://place-backend.example/v1/library/place-facets',
      `https://place-backend.example/v1/library/places/${placeId}/organization?limit=50&cursor=organization-2`,
      'https://place-backend.example/v1/library/collections?limit=50',
      `https://place-backend.example/v1/library/collections/${collectionId}?limit=20&cursor=page-2`,
      'https://place-backend.example/v1/library/tags?limit=50',
      'https://place-backend.example/v1/library/commands',
      `https://place-backend.example/v1/places/${placeId}`,
    ])
    expect(calls.every((call) => (
      new Headers(call.init.headers).get('authorization') === 'Bearer server-token'
    ))).toBe(true)
  })

  it('rejects an unbounded timeout', () => {
    expect(() => createLibraryBackendClient({ timeoutMilliseconds: 60_001 }))
      .toThrow('Library backend configuration is invalid')
  })
})
