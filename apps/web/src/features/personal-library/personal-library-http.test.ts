import { describe, expect, it } from 'vitest'

import {
  BrowserLibraryProblem,
  createPersonalLibraryHttp,
} from './personal-library-http'

const placeId = '01992d20-0000-7000-8000-000000000001'
const tagA = '01992d20-0000-7000-8000-000000000002'
const tagB = '01992d20-0000-7000-8000-000000000003'

describe('personal library browser interface', () => {
  it('serializes stable repeated Tag IDs and parses a versioned Place page', async () => {
    const calls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({
        schemaVersion: 'library-place-list.v2',
        filter: { state: 'saved', tagIds: [tagA, tagB], tagMatch: 'any' },
        items: [{
          placeId,
          saved: true,
          wanted: false,
          personalRating: null,
          updatedAt: '2026-08-28T00:00:00.000Z',
          place: null,
        }],
        nextCursor: 'next-page',
      })
    }
    const http = createPersonalLibraryHttp(fetcher as unknown as typeof fetch)

    await expect(http.places('saved', [tagB, tagA], 'any')).resolves.toMatchObject({
      rows: [{ placeId }], nextCursor: 'next-page',
    })
    expect(calls[0]).toBe(
      `/api/library/places?state=saved&tagMatch=any&tagIds=${tagA}&tagIds=${tagB}&limit=20`,
    )
  })

  it('surfaces authentication absence without interpreting a problem body', async () => {
    const http = createPersonalLibraryHttp(async () => Response.json({}, { status: 401 }))

    await expect(http.tags()).rejects.toEqual(new BrowserLibraryProblem(401))
  })

  it('keeps collection metadata separate from normalized Place rows', async () => {
    const fetcher = async () => Response.json({
      schemaVersion: 'library-collection-detail.v1',
      collection: {
        collectionId: tagA,
        name: '성수동',
        description: null,
        visibility: 'private',
        publicationId: null,
        placeCount: 1,
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
      places: [{
        placeId,
        position: 0,
        addedAt: '2026-08-28T00:00:00.000Z',
        place: null,
      }],
    })
    const http = createPersonalLibraryHttp(fetcher as unknown as typeof fetch)

    await expect(http.collection(tagA)).resolves.toEqual({
      rows: [{
        placeId,
        position: 0,
        addedAt: '2026-08-28T00:00:00.000Z',
        place: null,
      }],
      nextCursor: undefined,
      collectionName: '성수동',
    })
  })
})
