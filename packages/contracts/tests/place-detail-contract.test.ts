import { describe, expect, it } from 'vitest'

import { memberPlaceDetailResponseV2Schema, placeDetailResponseSchema, publicPlaceDetailResponseSchema } from '../src/places/index.js'

const placeId = '01992d20-2000-7000-8000-000000000001'

describe('place detail contract', () => {
  it('already admits null coordinates in frozen public v1 and member v2', () => {
    const facts = { status: 'available', requestedPlaceId: placeId, placeId, redirectedFrom: [],
      name: '좌표 없는 전시 공간', areaLabel: null, location: null, primaryTaxonomy: null, taxonomyKeys: [],
      evidence: { status: 'unverified', projectedAt: '2026-09-06T00:00:00.000Z' } }
    expect(publicPlaceDetailResponseSchema.parse({ ...facts, schemaVersion: 'place-detail.v1' }).location).toBeNull()
    expect(memberPlaceDetailResponseV2Schema.parse({ ...facts, schemaVersion: 'place-detail.v2', personalState: {
      saved: false, wanted: false, personalRating: null, preferencesUpdatedAt: null, visits: { visited: false, count: 0 },
    } }).location).toBeNull()
  })

  it('admits source observations only in the required v2 member overlay', () => {
    const detail = { schemaVersion: 'place-detail.v2', status: 'pending', requestedPlaceId: placeId,
      placeId, redirectedFrom: [], personalState: { saved: true, wanted: false, personalRating: null,
        preferencesUpdatedAt: null, visits: { visited: false, count: 0 }, sourceObservedPlace: {
          name: '개인 별명', address: '서울 성동구', categoryLabel: '공급자 원본 분류',
          location: { latitude: 37.54, longitude: 127.05 }, capturedAt: '2026-09-06T00:00:00.000Z',
        } } }
    expect(memberPlaceDetailResponseV2Schema.parse(detail)).toEqual(detail)
    expect(placeDetailResponseSchema.safeParse({ ...detail, schemaVersion: 'place-detail.v1' }).success).toBe(false)
    expect(publicPlaceDetailResponseSchema.safeParse(detail).success).toBe(false)
    expect(memberPlaceDetailResponseV2Schema.safeParse({ ...detail, personalState: undefined }).success).toBe(false)
    expect(memberPlaceDetailResponseV2Schema.safeParse({ ...detail, name: '가짜 공개 이름' }).success).toBe(false)
    expect(memberPlaceDetailResponseV2Schema.safeParse({ ...detail, personalState: {
      ...detail.personalState, sourceObservedPlace: { ...detail.personalState.sourceObservedPlace, providerPayload: {} },
    } }).success).toBe(false)
  })

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
