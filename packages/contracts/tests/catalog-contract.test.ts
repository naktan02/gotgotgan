import { describe, expect, it } from 'vitest'

import {
  catalogCurrentProfileSchema,
  catalogFactAssertionBatchSchema,
  catalogMediaSchema,
  catalogProfileContentSchema,
  catalogPublishProfileCommandSchema,
  catalogPublishProfileResultSchema,
  publicDisplayableCatalogMediaSchema,
} from '../src/catalog/index.js'

const assertionId = '01992d20-3000-7000-8000-000000000001'
const secondAssertionId = '01992d20-3000-7000-8000-000000000002'
const observationId = '01992d20-3000-7000-8000-000000000003'
const batchId = '01992d20-3000-7000-8000-000000000004'
const placeId = '01992d20-3000-7000-8000-000000000005'
const commandId = '01992d20-3000-7000-8000-000000000006'
const observedAt = '2026-09-03T10:00:00+09:00'

const emptyProfile = {
  displayName: { value: { text: '곳곳간 라멘 연구소', languageTag: 'ko' }, sourceAssertionId: assertionId },
  formattedAddress: null,
  location: null,
  operationalStatus: null,
  phone: null,
  website: null,
  openingHours: null,
  taxonomyAssignments: [],
  areaAssignments: [],
  media: [],
}

describe('Catalog assertion and profile contracts', () => {
  it('accepts provider identity and canonical Place subjects with typed facts', () => {
    const facts = [
      { kind: 'name', value: { text: '라멘 연구소', languageTag: 'ko' } },
      { kind: 'formatted-address', value: { text: '서울 성동구 성수동', languageTag: 'ko' } },
      { kind: 'location', value: { latitude: 37.544, longitude: 127.056 } },
      { kind: 'operational-status', value: { status: 'operating' } },
      { kind: 'phone', value: { display: '02-123-4567', e164: '+8221234567' } },
      { kind: 'website', value: { uri: 'https://example.com/place' } },
      {
        kind: 'opening-hours',
        value: {
          timeZone: 'Asia/Seoul',
          weeklyPeriods: [{
            opens: { dayOfWeek: 'monday', localTime: '11:00' },
            closes: { dayOfWeek: 'monday', localTime: '21:00' },
          }],
        },
      },
      { kind: 'taxonomy', value: { key: 'food.ramen.shoyu', version: 3, role: 'primary' } },
      { kind: 'area', value: { key: 'kr.seoul.seongdong.seongsu', version: 2, role: 'primary' } },
      {
        kind: 'media',
        value: {
          externalUri: 'https://provider.example.com/media/place.jpg',
          size: { width: 1200, height: 800 },
          rightsState: 'attribution-required',
          requiredAttributions: [{ label: 'Example Maps', uri: 'https://example.com' }],
        },
      },
    ]
    for (const subject of [
      { kind: 'provider-identity', providerKey: 'naver', externalPlaceId: 'naver-place-1' },
      { kind: 'canonical-place', placeId },
    ]) {
      const assertions = facts.map((fact, index) => ({
        assertionId: `01992d20-3000-7000-8000-${String(index + 10).padStart(12, '0')}`,
        subject,
        fact,
        sourceObservationId: observationId,
        observedAt,
        confidence: index / facts.length,
        rightsProfileKey: 'provider.standard.v1',
      }))

      expect(catalogFactAssertionBatchSchema.safeParse({
        schemaVersion: 'catalog-fact-assertion-batch.v1',
        batchId,
        recordedAt: observedAt,
        assertions,
      }).success).toBe(true)
    }
  })

  it('rejects raw provider payload and duplicate assertion IDs', () => {
    const assertion = {
      assertionId,
      subject: { kind: 'provider-identity', providerKey: 'google', externalPlaceId: 'google-123' },
      fact: { kind: 'name', value: { text: 'Typed name' } },
      sourceObservationId: observationId,
      observedAt,
      confidence: 1,
      rightsProfileKey: 'google.profile.v1',
    }
    expect(catalogFactAssertionBatchSchema.safeParse({
      schemaVersion: 'catalog-fact-assertion-batch.v1',
      batchId,
      recordedAt: observedAt,
      providerRawPayload: { name: 'must not cross the seam' },
      assertions: [assertion],
    }).success).toBe(false)
    expect(catalogFactAssertionBatchSchema.safeParse({
      schemaVersion: 'catalog-fact-assertion-batch.v1',
      batchId,
      recordedAt: observedAt,
      assertions: [assertion, assertion],
    }).success).toBe(false)
  })

  it('requires one subject and source observation context per assertion batch', () => {
    const assertion = {
      assertionId,
      subject: { kind: 'provider-identity', providerKey: 'google', externalPlaceId: 'google-123' },
      fact: { kind: 'name', value: { text: 'Typed name' } },
      sourceObservationId: observationId,
      observedAt,
      confidence: 0.25,
      rightsProfileKey: 'google.profile.v1',
    }
    const mismatches = [
      { subject: { kind: 'provider-identity', providerKey: 'google', externalPlaceId: 'google-456' } },
      { sourceObservationId: '01992d20-3000-7000-8000-000000000020' },
      { observedAt: '2026-09-03T10:01:00+09:00' },
      { rightsProfileKey: 'google.profile.v2' },
    ]

    for (const mismatch of mismatches) {
      expect(catalogFactAssertionBatchSchema.safeParse({
        schemaVersion: 'catalog-fact-assertion-batch.v1',
        batchId,
        recordedAt: observedAt,
        assertions: [assertion, {
          ...assertion,
          assertionId: secondAssertionId,
          confidence: 0.95,
          ...mismatch,
        }],
      }).success).toBe(false)
    }

    expect(catalogFactAssertionBatchSchema.safeParse({
      schemaVersion: 'catalog-fact-assertion-batch.v1',
      batchId,
      recordedAt: observedAt,
      assertions: [assertion, {
        ...assertion,
        assertionId: secondAssertionId,
        confidence: 0.95,
      }],
    }).success).toBe(true)
  })

  it('rejects assertion metadata that cannot be preserved by the Catalog ledger', () => {
    const assertion = {
      assertionId,
      subject: { kind: 'provider-identity', providerKey: 'google', externalPlaceId: 'google-123' },
      fact: { kind: 'name', value: { text: 'Typed name', languageTag: 'en' } },
      sourceObservationId: observationId,
      observedAt,
      confidence: 0.875,
      rightsProfileKey: 'google.profile.v1',
    }
    const invalidInputs = [
      { recordedAt: '2026-09-03T09:59:59+09:00', assertions: [assertion] },
      { recordedAt: observedAt, assertions: [{ ...assertion, rightsProfileKey: 'google-profile' }] },
      { recordedAt: observedAt, assertions: [{ ...assertion, confidence: 0.8755 }] },
      {
        recordedAt: observedAt,
        assertions: [{
          ...assertion,
          fact: { kind: 'name', value: { text: 'Typed name', languageTag: 'en-x' } },
        }],
      },
      {
        recordedAt: observedAt,
        assertions: [{
          ...assertion,
          fact: { kind: 'website', value: { uri: 'https://user:password@example.com/place' } },
        }],
      },
      {
        recordedAt: observedAt,
        assertions: [{
          ...assertion,
          fact: { kind: 'taxonomy', value: { key: 'food.ramen', version: 2_147_483_648, role: 'primary' } },
        }],
      },
      {
        recordedAt: observedAt,
        assertions: [{
          ...assertion,
          fact: { kind: 'area', value: { key: 'kr.seoul', version: 2_147_483_648, role: 'primary' } },
        }],
      },
    ]

    for (const input of invalidInputs) {
      expect(catalogFactAssertionBatchSchema.safeParse({
        schemaVersion: 'catalog-fact-assertion-batch.v1',
        batchId,
        ...input,
      }).success).toBe(false)
    }
  })

  it('keeps operational status separate from Canonical identity retirement', () => {
    expect(catalogFactAssertionBatchSchema.safeParse({
      schemaVersion: 'catalog-fact-assertion-batch.v1',
      batchId,
      recordedAt: observedAt,
      assertions: [{
        assertionId,
        subject: { kind: 'canonical-place', placeId },
        fact: { kind: 'operational-status', value: { status: 'retired' } },
        sourceObservationId: observationId,
        observedAt,
        confidence: 1,
        rightsProfileKey: 'internal.review.v1',
      }],
    }).success).toBe(false)
    expect(catalogCurrentProfileSchema.safeParse({
      schemaVersion: 'catalog-current-profile.v1',
      placeId,
      identityState: 'retired',
      revision: 2,
      policyVersion: 'catalog-policy.v2',
      publishedAt: observedAt,
      evidenceAssertionIds: [assertionId],
      profile: emptyProfile,
    }).success).toBe(true)
  })

  it('allows review media but only publishes displayable rights states', () => {
    const displayAllowed = {
      mediaReferenceId: '01992d20-3000-7000-8000-000000000090',
      displayUri: 'https://images.example.com/allowed.jpg',
      rightsState: 'display-allowed',
      requiredAttributions: [],
      validUntil: '2027-09-03T00:00:00Z',
      sourceAssertionId: assertionId,
    }
    const attributionRequired = {
      mediaReferenceId: '01992d20-3000-7000-8000-000000000091',
      displayUri: 'https://images.example.com/attributed.jpg',
      rightsState: 'attribution-required',
      requiredAttributions: [{ label: '사진: 제공자' }],
    }
    expect(publicDisplayableCatalogMediaSchema.safeParse(displayAllowed).success).toBe(true)
    expect(publicDisplayableCatalogMediaSchema.safeParse(attributionRequired).success).toBe(true)

    for (const rightsState of ['unknown', 'restricted'] as const) {
      const sourceMedia = {
        externalUri: `https://provider.example.com/${rightsState}.jpg`,
        rightsState,
        requiredAttributions: [],
      }
      const publicMedia = {
        mediaReferenceId: rightsState === 'unknown'
          ? '01992d20-3000-7000-8000-000000000092'
          : '01992d20-3000-7000-8000-000000000093',
        displayUri: `https://media.gotgotgan.example/${rightsState}.jpg`,
        rightsState,
        requiredAttributions: [],
      }
      expect(catalogMediaSchema.safeParse(sourceMedia).success).toBe(true)
      expect(publicDisplayableCatalogMediaSchema.safeParse(publicMedia).success).toBe(false)
    }
    expect(publicDisplayableCatalogMediaSchema.safeParse({
      ...attributionRequired,
      requiredAttributions: [],
    }).success).toBe(false)
    expect(catalogMediaSchema.safeParse({
      externalUri: 'https://provider.example.com/review-only.jpg',
      displayUri: 'https://media.gotgotgan.example/must-not-cross.jpg',
      rightsState: 'display-allowed',
      requiredAttributions: [],
    }).success).toBe(false)
  })

  it('publishes with optimistic revision, policy, rationale, and complete evidence', () => {
    const command = {
      schemaVersion: 'catalog-publish-profile-command.v1',
      commandId,
      placeId,
      expectedRevision: null,
      policyVersion: 'catalog-policy.v2',
      rationale: 'Provider assertions agree after duplicate review.',
      evidenceAssertionIds: [assertionId, secondAssertionId],
      profile: {
        ...emptyProfile,
        media: [{
          mediaReferenceId: '01992d20-3000-7000-8000-000000000094',
          sourceAssertionId: secondAssertionId,
        }],
      },
    }
    expect(catalogPublishProfileCommandSchema.safeParse(command).success).toBe(true)
    expect(catalogPublishProfileCommandSchema.safeParse({
      ...command,
      evidenceAssertionIds: [assertionId],
    }).success).toBe(false)

    const currentProfile = {
      schemaVersion: 'catalog-current-profile.v1',
      placeId,
      identityState: 'active',
      revision: 1,
      policyVersion: command.policyVersion,
      publishedAt: observedAt,
      evidenceAssertionIds: command.evidenceAssertionIds,
      profile: command.profile,
    }
    expect(catalogPublishProfileResultSchema.safeParse({
      schemaVersion: 'catalog-publish-profile-result.v1',
      outcome: 'accepted',
      commandId,
      status: 'applied',
      currentProfile,
    }).success).toBe(true)
    expect(catalogPublishProfileResultSchema.safeParse({
      schemaVersion: 'catalog-publish-profile-result.v1',
      outcome: 'rejected',
      commandId,
      rejection: { code: 'revision-conflict', currentRevision: 3 },
    }).success).toBe(true)
  })

  it('has no legacy saved or wanted state in the Catalog profile', () => {
    expect(catalogProfileContentSchema.safeParse({ ...emptyProfile, saved: true }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({ ...emptyProfile, wanted: true }).success).toBe(false)
  })

  it('keeps Canonical profile media as stable references without a display URL', () => {
    const mediaReferenceId = '01992d20-3000-7000-8000-000000000094'
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      media: [{ mediaReferenceId, sourceAssertionId: assertionId }],
    }).success).toBe(true)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      media: [{
        mediaReferenceId,
        displayUri: 'https://media.gotgotgan.example/leak.jpg',
        sourceAssertionId: assertionId,
      }],
    }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      media: [{
        mediaReferenceId,
        externalUri: 'https://provider.example.com/leak.jpg',
        sourceAssertionId: assertionId,
      }],
    }).success).toBe(false)
  })

  it('requires evidence on every selected profile value', () => {
    const taxonomyAssignment = {
      key: 'food.ramen',
      version: 1,
      role: 'primary',
    }
    const areaAssignment = {
      key: 'kr.seoul',
      version: 1,
      role: 'primary',
    }
    const mediaReference = {
      mediaReferenceId: '01992d20-3000-7000-8000-000000000094',
    }

    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      displayName: { value: { text: '근거 없는 이름' } },
    }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      formattedAddress: { value: { text: '근거 없는 주소' } },
    }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      taxonomyAssignments: [taxonomyAssignment],
    }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      areaAssignments: [areaAssignment],
    }).success).toBe(false)
    expect(catalogProfileContentSchema.safeParse({
      ...emptyProfile,
      media: [mediaReference],
    }).success).toBe(false)
    expect(catalogCurrentProfileSchema.safeParse({
      schemaVersion: 'catalog-current-profile.v1',
      placeId,
      identityState: 'active',
      revision: 1,
      policyVersion: 'catalog-policy.v2',
      publishedAt: observedAt,
      evidenceAssertionIds: [secondAssertionId],
      profile: emptyProfile,
    }).success).toBe(false)
  })

  it('rejects profile selections that the exact-version projection cannot represent', () => {
    const media = Array.from({ length: 33 }, (_, index) => ({
      mediaReferenceId: `01992d20-3000-7000-8000-${String(index + 100).padStart(12, '0')}`,
      sourceAssertionId: assertionId,
    }))
    const invalidProfiles = [
      { ...emptyProfile, media },
      {
        ...emptyProfile,
        taxonomyAssignments: [
          { key: 'food.ramen', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'food.ramen', version: 1, role: 'secondary', sourceAssertionId: secondAssertionId },
        ],
      },
      {
        ...emptyProfile,
        taxonomyAssignments: [
          { key: 'food.ramen', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'food.cafe', version: 1, role: 'primary', sourceAssertionId: secondAssertionId },
        ],
      },
      {
        ...emptyProfile,
        areaAssignments: [
          { key: 'kr.seoul', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'kr.seoul', version: 1, role: 'alternate', sourceAssertionId: secondAssertionId },
        ],
      },
      {
        ...emptyProfile,
        areaAssignments: [
          { key: 'kr.seoul', version: 1, role: 'primary', sourceAssertionId: assertionId },
          { key: 'kr.busan', version: 1, role: 'primary', sourceAssertionId: secondAssertionId },
        ],
      },
      {
        ...emptyProfile,
        media: [media[0], { ...media[0], sourceAssertionId: secondAssertionId }],
      },
    ]

    for (const profile of invalidProfiles) {
      expect(catalogProfileContentSchema.safeParse(profile).success).toBe(false)
    }
  })
})
