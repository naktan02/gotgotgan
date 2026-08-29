import { describe, expect, it } from 'vitest'

import { placeDetailResponseSchema } from '../src/places/index.js'

const placeId = '01992d20-2000-7000-8000-000000000001'

describe('place detail contract', () => {
  it('keeps public place facts separate from an optional personal overlay', () => {
    const detail = placeDetailResponseSchema.parse({
      schemaVersion: 'place-detail.v1',
      status: 'available',
      requestedPlaceId: placeId,
      placeId,
      redirectedFrom: [],
      name: '조용한 라멘 연구소',
      areaLabel: '성수',
      location: { latitude: 37.5445, longitude: 127.056 },
      primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
      taxonomyKeys: ['food.noodle.ramen'],
      evidence: { status: 'verified', projectedAt: '2026-08-26T00:00:00.000Z' },
      personalState: {
        saved: true,
        wanted: false,
        personalRating: 4.4,
        preferencesUpdatedAt: '2026-08-26T01:00:00.000Z',
        visits: {
          visited: true,
          count: 2,
          firstVisitedAt: '2026-07-01T00:00:00.000Z',
          lastVisitedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    })

    expect(detail.personalState?.visits.count).toBe(2)
    expect(detail).not.toHaveProperty('openingHours')
    expect(detail).not.toHaveProperty('providerPayload')
  })

  it('accepts an anonymous redirected projection without personal data', () => {
    const detail = placeDetailResponseSchema.parse({
      schemaVersion: 'place-detail.v1',
      status: 'redirected',
      requestedPlaceId: '01992d20-2000-7000-8000-000000000002',
      placeId,
      redirectedFrom: ['01992d20-2000-7000-8000-000000000002'],
      name: '조용한 라멘 연구소',
      areaLabel: null,
      location: { latitude: 37.5445, longitude: 127.056 },
      primaryTaxonomy: null,
      taxonomyKeys: [],
      evidence: { status: 'unverified', projectedAt: '2026-08-26T00:00:00.000Z' },
    })

    expect(detail.status).toBe('redirected')
    expect(detail.personalState).toBeUndefined()
  })

  it('represents a member-owned Place while its public detail is still pending', () => {
    const pending = {
      schemaVersion: 'place-detail.v1',
      status: 'pending',
      requestedPlaceId: placeId,
      placeId,
      redirectedFrom: [],
      personalState: {
        saved: true,
        wanted: false,
        personalRating: null,
        preferencesUpdatedAt: '2026-08-26T01:00:00.000Z',
        visits: { visited: false, count: 0 },
      },
    } as const

    expect(placeDetailResponseSchema.parse(pending)).toEqual(pending)
    expect(() => placeDetailResponseSchema.parse({
      ...pending,
      personalState: undefined,
    })).toThrow()
    expect(() => placeDetailResponseSchema.parse({
      ...pending,
      name: '근거 없이 만든 공개 장소명',
    })).toThrow()
  })
})
