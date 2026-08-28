import { describe, expect, it } from 'vitest'

import {
  BrowserLibraryProblem,
  createPersonalLibraryHttp,
} from './personal-library-http'

const placeId = '01992d20-0000-7000-8000-000000000001'
const tagA = '01992d20-0000-7000-8000-000000000002'
const tagB = '01992d20-0000-7000-8000-000000000003'
const collectionId = '01992d20-0000-7000-8000-000000000004'
const commandId = '01992d20-0000-7000-8000-000000000005'
const areaKey = 'area_abcdefghijklmnopqrstuv'

describe('personal library browser interface', () => {
  it('serializes stable repeated Tag IDs and parses a versioned Place page', async () => {
    const calls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return Response.json({
        schemaVersion: 'library-place-list.v3',
        filter: {
          state: 'saved', tagIds: [tagA, tagB], tagMatch: 'any',
          areaKeys: [areaKey], taxonomyKeys: ['food.noodle.ramen'],
        },
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

    await expect(http.places(
      'saved', [tagB, tagA], 'any', [areaKey], ['food.noodle.ramen'],
    )).resolves.toMatchObject({
      rows: [{ placeId }], nextCursor: 'next-page',
    })
    expect(calls[0]).toBe(
      `/api/library/places?state=saved&tagMatch=any&tagIds=${tagA}&tagIds=${tagB}&areaKeys=${areaKey}&taxonomyKeys=food.noodle.ramen&limit=20`,
    )
  })

  it('reads saved-Place area and taxonomy facets separately from list pagination', async () => {
    const http = createPersonalLibraryHttp(async () => Response.json({
      schemaVersion: 'library-place-facets.v1', sourceState: 'saved',
      coverage: { savedPlaceCount: 2, sampledPlaceCount: 2, projectedPlaceCount: 1, complete: true },
      areas: [{ key: areaKey, label: '서울 성동구', count: 1 }],
      taxonomies: [{ key: 'food.noodle.ramen', label: '라멘', count: 1 }],
    }))

    await expect(http.facets()).resolves.toMatchObject({
      sourceState: 'saved', areas: [{ key: areaKey }],
    })
  })

  it('surfaces authentication absence without interpreting a problem body', async () => {
    const http = createPersonalLibraryHttp(async () => Response.json({}, { status: 401 }))

    await expect(http.tags()).rejects.toEqual(new BrowserLibraryProblem(401))
  })

  it('reads member-scoped organization choices and posts an append command without a position', async () => {
    const calls: Array<Readonly<{ input: string; init?: RequestInit }>> = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init })
      if (init?.method === 'POST') {
        return Response.json({ schemaVersion: 'library-command-result.v1', status: 'applied' })
      }
      return Response.json({
        schemaVersion: 'library-place-organization.v1',
        placeId,
        items: [{
          kind: 'collection', collectionId, name: 'NAVER · 라멘', selected: false, position: null,
        }],
      })
    }
    const http = createPersonalLibraryHttp(fetcher as unknown as typeof fetch)

    await expect(http.organization(placeId)).resolves.toMatchObject({
      items: [{ collectionId, selected: false }],
    })
    await expect(http.command({
      commandId,
      command: { kind: 'add-collection-place', collectionId, placeId },
    })).resolves.toMatchObject({ status: 'applied' })
    expect(calls[0]?.input).toBe(
      `/api/library/places/${placeId}/organization?limit=50`,
    )
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      commandId,
      command: { kind: 'add-collection-place', collectionId, placeId },
    })
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
