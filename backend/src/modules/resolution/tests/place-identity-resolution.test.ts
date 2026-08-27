import { describe, expect, it, vi } from 'vitest'

import {
  createPlaceIdentityResolver,
  type MatchAssessment,
  type NormalizedPlaceIdentityEvidence,
  type PlaceIdentityResolutionStore,
} from '../index.js'

const at = '2026-08-28T06:00:00.000Z'
const naverObservation = '01993020-0000-7000-8000-000000000001'
const googleObservation = '01993020-0000-7000-8000-000000000002'

function storeFixture(candidates: readonly NormalizedPlaceIdentityEvidence[] = []) {
  const indexed: NormalizedPlaceIdentityEvidence[] = []
  const assessments: MatchAssessment[] = []
  const store: PlaceIdentityResolutionStore = {
    indexEvidence: vi.fn(async ({ evidence }) => {
      indexed.push(evidence)
      return 'recorded' as const
    }),
    findCandidates: vi.fn(async () => candidates),
    appendAssessment: vi.fn(async (assessment) => {
      assessments.push(assessment)
      return 'recorded' as const
    }),
  }
  return { store, indexed, assessments }
}

describe('place identity resolution interface', () => {
  it('preserves raw multilingual names and stores separate comparison representations', async () => {
    const fixture = storeFixture()
    const resolver = createPlaceIdentityResolver({ store: fixture.store, now: () => new Date(at) })

    await resolver.evaluate({
      sourceObservationId: naverObservation,
      providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-place-1' },
      observedAt: at,
      names: [
        { text: '스타벅스  강남점', languageTag: 'ko' },
        { text: 'Starbucks Gangnam', languageTag: 'en' },
      ],
      address: '서울특별시 강남구',
      website: 'https://www.starbucks.co.kr/store/store_map.do',
      location: { latitude: 37.498, longitude: 127.027 },
    })

    expect(fixture.indexed[0]).toMatchObject({
      names: [
        { rawText: '스타벅스  강남점', languageTag: 'ko', normalizedText: '스타벅스 강남점' },
        { rawText: 'Starbucks Gangnam', languageTag: 'en', normalizedText: 'starbucks gangnam' },
      ],
      websiteHost: 'starbucks.co.kr',
    })
  })

  it('treats cross-script names as unknown and combines independent evidence conservatively', async () => {
    const seedFixture = storeFixture()
    const seed = createPlaceIdentityResolver({
      store: seedFixture.store,
      now: () => new Date(at),
    })
    await seed.evaluate({
      sourceObservationId: googleObservation,
      providerIdentity: { providerKey: 'google', externalPlaceId: 'google-place-1' },
      observedAt: at,
      names: [{ text: 'Seoul Civic Hall', languageTag: 'en' }],
      phone: '+82 2-120-0000',
      location: { latitude: 37.5665, longitude: 126.978 },
    })
    const google = seedFixture.indexed[0]
    if (google === undefined) throw new Error('Google evidence was not indexed')

    const fixture = storeFixture([google])
    const resolver = createPlaceIdentityResolver({ store: fixture.store, now: () => new Date(at) })
    const result = await resolver.evaluate({
      sourceObservationId: naverObservation,
      providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-place-1' },
      observedAt: at,
      names: [{ text: '서울시민청', languageTag: 'ko' }],
      phone: '02-120-0000',
      location: { latitude: 37.56651, longitude: 126.97801 },
    })

    expect(result.assessments).toEqual([
      expect.objectContaining({
        classification: 'likely-same',
        reasons: expect.arrayContaining(['cross-script-name', 'exact-phone', 'nearby-location']),
      }),
    ])
    expect(fixture.assessments[0]?.features.nameSimilarity).toBeNull()
  })

  it('keeps same-name distant places and same-building different floors out of auto decisions', async () => {
    const firstFixture = storeFixture()
    const firstResolver = createPlaceIdentityResolver({
      store: firstFixture.store,
      now: () => new Date(at),
    })
    await firstResolver.evaluate({
      sourceObservationId: googleObservation,
      providerIdentity: { providerKey: 'google', externalPlaceId: 'google-place-1' },
      observedAt: at,
      names: [{ text: 'COMMON CAFE', languageTag: 'en' }],
      floor: '2F',
      location: { latitude: 37.5665, longitude: 126.978 },
    })
    const candidate = firstFixture.indexed[0]
    if (candidate === undefined) throw new Error('Candidate evidence was not indexed')

    const distant = storeFixture([candidate])
    const distantResult = await createPlaceIdentityResolver({
      store: distant.store,
      now: () => new Date(at),
    }).evaluate({
      sourceObservationId: naverObservation,
      providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-place-1' },
      observedAt: at,
      names: [{ text: 'Common Cafe', languageTag: 'en' }],
      floor: '2층',
      location: { latitude: 37.45, longitude: 127.15 },
    })
    expect(distantResult.assessments[0]).toMatchObject({
      classification: 'likely-different',
      reasons: expect.arrayContaining(['far-apart-concurrent-observations']),
    })

    const sameBuilding = storeFixture([candidate])
    const sameBuildingResult = await createPlaceIdentityResolver({
      store: sameBuilding.store,
      now: () => new Date(at),
    }).evaluate({
      sourceObservationId: naverObservation,
      providerIdentity: { providerKey: 'naver', externalPlaceId: 'naver-place-1' },
      observedAt: at,
      names: [{ text: 'Common Cafe', languageTag: 'en' }],
      floor: '3F',
      location: { latitude: 37.5665, longitude: 126.978 },
    })
    expect(sameBuildingResult.assessments[0]).toMatchObject({
      classification: 'likely-different',
      reasons: expect.arrayContaining(['different-floor']),
    })
  })
})
