import { describe, expect, it } from 'vitest'

import {
  browserPrivateNoteCommandRequestSchema,
  currentMembershipConsentsSchema,
  currentMembershipSchema,
  membershipOnboardingResultSchema,
  processStatusSchema,
  publishedCollectionMapQuerySchema,
  publishedCollectionMapSchema,
  publishedCollectionSchema,
  publishedWritingSchema,
} from '../src/http/index.js'
import {
  libraryCommandResultSchema,
  libraryPlacePreferencesResponseSchema,
} from '../src/library/index.js'
import { publicPlaceDetailResponseSchema } from '../src/places/index.js'
import {
  publicProfileAppealQueueSchema,
  publicProfileAppealRequestSchema,
  publicProfileAppealResolutionRequestSchema,
  publicProfileHandleSchema,
  publicProfileModerationRequestSchema,
  publicProfileModerationNoticesSchema,
  publicProfileProjectionSchema,
  publicProfileReportQueueSchema,
  publicProfileReportRequestSchema,
  setPublicProfileRequestSchema,
} from '../src/profiles/index.js'
import {
  visitRecordResultSchema,
  visitSummaryResponseSchema,
} from '../src/visits/index.js'
import { writingCommandResultSchema } from '../src/writing/index.js'

const membershipId = '01992d20-0000-7000-8000-000000000001'
const placeId = '01992d20-0000-7000-8000-000000000002'
const publicationId = '01992d20-0000-7000-8000-000000000003'
const documentId = '01992d20-0000-7000-8000-000000000004'

describe('versioned product HTTP results', () => {
  it('keeps process and membership projections explicitly versioned', () => {
    expect(processStatusSchema.parse({
      schemaVersion: 'place-process-status.v1', service: 'place', state: 'ok',
    })).toMatchObject({ state: 'ok' })
    expect(currentMembershipSchema.parse({
      schemaVersion: 'place-current-membership.v1', membershipId,
      authorityRole: 'member', userGrade: 'newcomer', productTier: 'free',
    })).toMatchObject({ membershipId })
    expect(currentMembershipConsentsSchema.parse({
      schemaVersion: 'place-membership-consents.v1',
      consents: [{ document: 'terms', version: '2026-08-28' }],
    }).consents).toHaveLength(1)
    expect(membershipOnboardingResultSchema.parse({
      schemaVersion: 'place-membership-onboarding-result.v1', status: 'created',
      membershipId, authorityRole: 'member', userGrade: 'newcomer', productTier: 'free',
    }).status).toBe('created')
  })

  it('publishes strict owner-scoped command and preference results', () => {
    expect(libraryCommandResultSchema.parse({
      schemaVersion: 'library-command-result.v1', status: 'replayed',
    }).status).toBe('replayed')
    expect(libraryPlacePreferencesResponseSchema.safeParse({
      schemaVersion: 'library-place-preferences.v1', placeId,
      saved: true, wanted: false, personalRating: 4.5,
      updatedAt: '2026-08-28T00:00:00.000Z',
      memberId: '01992d20-0000-7000-8000-000000000001',
    }).success).toBe(false)
    expect(visitRecordResultSchema.parse({
      schemaVersion: 'visit-record-result.v1', status: 'recorded',
    }).status).toBe('recorded')
    expect(visitSummaryResponseSchema.parse({
      schemaVersion: 'visit-summary.v1', placeId, visited: false, count: 0,
    }).visited).toBe(false)
    expect(writingCommandResultSchema.parse({
      schemaVersion: 'writing-command-result.v1', status: 'applied', documentId, version: 1,
    }).status).toBe('applied')
    expect(browserPrivateNoteCommandRequestSchema.parse({
      commandId: membershipId,
      command: { kind: 'create-note', documentId, placeId, body: '비공개 메모' },
    }).command.kind).toBe('create-note')
    expect(browserPrivateNoteCommandRequestSchema.safeParse({
      commandId: membershipId,
      command: {
        kind: 'create-note', documentId, placeId, body: '공개 메모', visibility: 'public',
      },
    }).success).toBe(false)
  })

  it('versions both public content projections without exposing owner evidence', () => {
    const collection = {
      schemaVersion: 'place-published-collection.v3' as const, publicationId,
      visibility: 'public' as const, name: '서울', description: null,
      placeCount: 1,
      places: [{
        placeId,
        position: 0,
        place: {
          placeId,
          name: '조용한 라멘 연구소',
          areaLabel: '서울 성동구 성수동',
          location: { latitude: 37.5445, longitude: 127.056 },
          primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
          taxonomyKeys: ['food.noodle.ramen'],
          evidence: { status: 'verified' as const, projectedAt: '2026-08-28T00:00:00.000Z' },
        },
      }],
      updatedAt: '2026-08-28T00:00:00.000Z',
    }
    expect(publishedCollectionSchema.parse(collection).schemaVersion)
      .toBe('place-published-collection.v3')
    expect(publishedCollectionSchema.safeParse({
      ...collection,
      places: [{
        ...collection.places[0],
        place: { ...collection.places[0].place, personalRating: 4.9 },
      }],
    }).success).toBe(false)
    expect(publishedCollectionMapQuerySchema.parse({
      west: '126.9', south: '37.5', east: '127.1', north: '37.6', zoom: '12',
    })).toEqual({ west: 126.9, south: 37.5, east: 127.1, north: 37.6, zoom: 12 })
    expect(publishedCollectionMapSchema.parse({
      schemaVersion: 'place-published-collection-map.v1', publicationId,
      viewport: {
        bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
      },
      features: [{
        kind: 'place', placeId, label: '조용한 라멘 연구소',
        location: { latitude: 37.5445, longitude: 127.056 },
      }],
      coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
    }).coverage.representedPlaceCount).toBe(1)
    expect(publishedWritingSchema.safeParse({
      schemaVersion: 'place-published-writing.v1', kind: 'note', publicationId,
      visibility: 'public', body: '좋아요', placeIds: [placeId],
      updatedAt: '2026-08-28T00:00:00.000Z',
      memberId: '01992d20-0000-7000-8000-000000000001',
    }).success).toBe(false)
    const publicDetail = {
      schemaVersion: 'place-detail.v1' as const,
      status: 'available' as const,
      requestedPlaceId: placeId,
      placeId,
      redirectedFrom: [],
      ...collection.places[0].place,
    }
    expect(publicPlaceDetailResponseSchema.parse(publicDetail).placeId).toBe(placeId)
    expect(publicPlaceDetailResponseSchema.safeParse({
      ...publicDetail,
      personalState: {
        saved: true, wanted: false, personalRating: 4.9,
        preferencesUpdatedAt: '2026-08-28T00:00:00.000Z',
        visits: { visited: false, count: 0 },
      },
    }).success).toBe(false)
    expect(publicProfileHandleSchema.safeParse('ramen-log').success).toBe(true)
    expect(publicProfileHandleSchema.safeParse('search').success).toBe(false)
    expect(setPublicProfileRequestSchema.safeParse({
      commandId: placeId,
      profile: {
        handle: 'ramen-log', displayName: '라멘 기록', visibility: 'public',
        expectedUpdatedAt: null,
      },
    }).success).toBe(true)
    expect(publicProfileProjectionSchema.safeParse({
      schemaVersion: 'public-profile.v1',
      handle: 'ramen-log',
      displayName: '라멘 기록',
      collections: [{
        publicationId: placeId,
        name: '성수 라멘',
        description: null,
        placeCount: 3,
        updatedAt: '2026-08-28T00:00:00.000Z',
        visibility: 'unlisted',
      }],
    }).success).toBe(false)
    expect(publicProfileReportRequestSchema.safeParse({
      reportId: documentId, reason: 'spam', details: 'free-form text',
    }).success).toBe(false)
    expect(publicProfileModerationRequestSchema.safeParse({
      decisionId: documentId,
      moderation: { state: 'allowed', reason: 'spam', expectedUpdatedAt: null },
    }).success).toBe(false)
    expect(publicProfileModerationRequestSchema.safeParse({
      decisionId: documentId,
      moderation: { state: 'allowed', reason: 'appeal-accepted', expectedUpdatedAt: null },
    }).success).toBe(false)
    expect(publicProfileReportQueueSchema.safeParse({
      schemaVersion: 'public-profile-report-queue.v1',
      reports: [{
        reportId: documentId, handle: 'ramen-log', reason: 'spam',
        reportedAt: '2026-08-28T00:00:00.000Z',
        expiresAt: '2027-02-24T00:00:00.000Z',
        reporterMembershipId: membershipId,
      }],
    }).success).toBe(false)
    expect(publicProfileAppealRequestSchema.safeParse({
      appealId: documentId,
      noticeId: publicationId,
      reason: 'mistaken-identity',
      details: 'free-form appeal',
    }).success).toBe(false)
    expect(publicProfileAppealResolutionRequestSchema.safeParse({
      resolutionId: documentId,
      resolution: { outcome: 'accepted', reason: 'decision-upheld' },
    }).success).toBe(false)
    expect(publicProfileModerationNoticesSchema.safeParse({
      schemaVersion: 'public-profile-moderation-notices.v1',
      notices: [{
        noticeId: documentId,
        handle: 'ramen-log',
        kind: 'withheld',
        reason: 'spam',
        createdAt: '2026-08-28T00:00:00.000Z',
        acknowledgedAt: null,
        appeal: null,
        actorMembershipId: membershipId,
      }],
    }).success).toBe(false)
    expect(publicProfileAppealQueueSchema.safeParse({
      schemaVersion: 'public-profile-appeal-queue.v1',
      appeals: [{
        appealId: documentId,
        handle: 'ramen-log',
        reason: 'decision-context',
        submittedAt: '2026-08-28T00:00:00.000Z',
        moderationReason: 'privacy',
        moderationDecidedAt: '2026-08-27T00:00:00.000Z',
        ownerMembershipId: membershipId,
      }],
    }).success).toBe(false)
  })
})
