import { describe, expect, it } from 'vitest'

import { createPersonalPlaceClient } from './personal-place-client'

const placeId = '11111111-1111-4111-8111-111111111111'

describe('personal place client', () => {
  it('encodes the place identifier and cursor when reading organization', async () => {
    const requests: string[] = []
    const client = createPersonalPlaceClient(async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        schemaVersion: 'library-place-organization.v1',
        placeId,
        items: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await client.organization(placeId, 'next/cursor')

    expect(requests).toEqual([
      `/api/library/places/${placeId}/organization?limit=50&cursor=next%2Fcursor`,
    ])
  })

  it('reads canonical detail without exposing the backend origin', async () => {
    const requests: string[] = []
    const client = createPersonalPlaceClient(async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({
        schemaVersion: 'place-detail.v1',
        placeId,
        status: 'available',
        requestedPlaceId: placeId,
        name: '테스트 장소',
        redirectedFrom: [],
        areaLabel: null,
        location: null,
        primaryTaxonomy: null,
        taxonomyKeys: [],
        evidence: { status: 'unverified', projectedAt: '2026-09-05T00:00:00.000Z' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await client.place(placeId)

    expect(requests).toEqual([`/api/places/${placeId}`])
  })
})
