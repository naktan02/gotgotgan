import { describe, expect, it } from 'vitest'

import {
  collectionLifecycleCommandRequestV2Schema,
  collectionLifecycleCommandResultV2Schema,
  collectionOrderCommandRequestV2Schema,
  collectionOrderCommandResultV2Schema,
  libraryOperationRejectionV2Schema,
  libraryOperationReceiptV2Schema,
  personalLibraryOverlayV2Schema,
  personalLibraryWorkspaceHttpQueryV2Schema,
  personalLibraryWorkspaceRequestV2Schema,
  personalLibraryWorkspaceResponseV2Schema,
  placeFilingCommandRequestV2Schema,
  placeFilingCommandResultV2Schema,
  placeFilingRequestV2Schema,
  placeFilingResponseV2Schema,
} from '../src/library/index.js'

const placeId = '01992d20-3000-7000-8000-000000000001'
const secondPlaceId = '01992d20-3000-7000-8000-000000000002'
const collectionId = '01992d20-3000-7000-8000-000000000011'
const secondCollectionId = '01992d20-3000-7000-8000-000000000012'
const commandId = '01992d20-3000-7000-8000-000000000021'
const collectionRevision = 'collection-revision:01J670YJY00D3C4V7MZ31Q8N0Y'

describe('Collection-first Personal Library v2 contracts', () => {
  it('uses Collection membership as the favorite scope and keeps Rating independent', () => {
    expect(personalLibraryWorkspaceRequestV2Schema.parse({})).toEqual({
      favoriteScope: { kind: 'all' },
      ratingFilter: { kind: 'any' },
      tagIds: [],
      tagMatch: 'all',
      areaKeys: [],
      taxonomyKeys: [],
      limit: 20,
    })
    expect(personalLibraryWorkspaceRequestV2Schema.parse({
      favoriteScope: { kind: 'collection', collectionId },
      ratingFilter: { kind: 'unrated' },
      collectionCursor: 'collections-page-2',
      placeCursor: 'places-page-3',
    })).toMatchObject({
      favoriteScope: { kind: 'collection', collectionId },
      ratingFilter: { kind: 'unrated' },
      collectionCursor: 'collections-page-2',
      placeCursor: 'places-page-3',
    })
    expect(personalLibraryWorkspaceRequestV2Schema.safeParse({ cursor: 'ambiguous' }).success)
      .toBe(false)
    expect(personalLibraryWorkspaceRequestV2Schema.safeParse({ saved: true }).success).toBe(false)
    expect(personalLibraryWorkspaceRequestV2Schema.safeParse({ wanted: true }).success).toBe(false)
    expect(personalLibraryWorkspaceHttpQueryV2Schema.parse({
      collectionId,
      rating: 'rated',
      tagIds: placeId,
    })).toMatchObject({
      collectionId,
      rating: 'rated',
      tagIds: [placeId],
      limit: 20,
    })
  })

  it('publishes a bounded workspace without legacy Place states', () => {
    const workspace = personalLibraryWorkspaceResponseV2Schema.parse({
      schemaVersion: 'personal-library-workspace.v2',
      filter: {
        favoriteScope: { kind: 'all' },
        ratingFilter: { kind: 'rated' },
        tagIds: [],
        tagMatch: 'all',
        areaKeys: [],
        taxonomyKeys: [],
      },
      collections: [{
        collectionId,
        name: '도쿄 여행',
        description: null,
        visibility: 'private',
        publicationId: null,
        placeCount: 1,
        collectionRevision,
        updatedAt: '2026-09-03T00:00:00.000Z',
      }],
      collectionNextCursor: 'collections-page-2',
      places: [{
        placeId,
        overlay: { isFavorited: true, collectionCount: 1, personalRating: 4.5 },
        place: {
          placeId,
          name: '좌표 확인 중인 라멘집',
          areaLabel: '서울',
          location: null,
          primaryTaxonomy: { key: 'food.ramen', label: '라멘' },
          taxonomyKeys: ['food.ramen'],
          evidence: { status: 'unverified', projectedAt: '2026-09-03T00:00:00.000Z' },
        },
      }],
      placeNextCursor: 'places-page-2',
      availableFilters: {
        coverage: {
          favoritePlaceCount: 1, sampledPlaceCount: 1,
          projectedPlaceCount: 1, complete: true,
        },
        areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '서울', count: 1 }],
        taxonomies: [{ key: 'food.ramen', label: '라멘', count: 1 }],
      },
    })

    expect(workspace.places[0]?.overlay).toEqual({
      isFavorited: true,
      collectionCount: 1,
      personalRating: 4.5,
    })
    expect(workspace.collectionNextCursor).toBe('collections-page-2')
    expect(workspace.placeNextCursor).toBe('places-page-2')
    expect(personalLibraryOverlayV2Schema.safeParse({
      isFavorited: false,
      collectionCount: 1,
      personalRating: null,
    }).success).toBe(false)
  })

  it('reads paged filing choices with opaque Collection revisions', () => {
    expect(placeFilingRequestV2Schema.parse({})).toEqual({ limit: 20 })
    expect(placeFilingRequestV2Schema.safeParse({ limit: 51 }).success).toBe(false)

    const filing = placeFilingResponseV2Schema.parse({
      schemaVersion: 'place-filing.v2',
      placeId,
      overlay: { isFavorited: true, collectionCount: 1, personalRating: null },
      collections: [{
        collectionId,
        name: '서울 라멘',
        included: true,
        collectionRevision,
      }],
    })
    expect(filing.collections[0]?.collectionRevision).toBe(collectionRevision)
  })

  it('bounds and de-duplicates an atomic Place filing command', () => {
    const request = {
      schemaVersion: 'place-filing-command.v2' as const,
      commandId,
      placeId,
      changes: [{
        collectionId,
        expectedCollectionRevision: collectionRevision,
        desired: 'included' as const,
      }, {
        collectionId: secondCollectionId,
        expectedCollectionRevision: 'opaque-second-revision',
        desired: 'excluded' as const,
      }],
    }
    expect(placeFilingCommandRequestV2Schema.parse(request)).toEqual(request)
    expect(placeFilingCommandRequestV2Schema.safeParse({
      ...request,
      changes: [request.changes[0], request.changes[0]],
    }).success).toBe(false)
    expect(placeFilingCommandRequestV2Schema.safeParse({
      ...request,
      changes: [],
    }).success).toBe(false)
    expect(placeFilingCommandRequestV2Schema.safeParse({
      ...request,
      changes: Array.from({ length: 51 }, (_, index) => ({
        collectionId: `01992d20-3000-7000-8000-${String(index).padStart(12, '0')}`,
        expectedCollectionRevision: collectionRevision,
        desired: 'included',
      })),
    }).success).toBe(false)
  })

  it('returns a replay-safe receipt or a stable filing rejection', () => {
    expect(libraryOperationReceiptV2Schema.parse({ commandId, status: 'replayed' })).toEqual({
      commandId,
      status: 'replayed',
    })

    const accepted = placeFilingCommandResultV2Schema.parse({
      schemaVersion: 'place-filing-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId, status: 'applied' },
      placeId,
      overlay: { isFavorited: true, collectionCount: 1, personalRating: null },
      collections: [{ collectionId, included: true, collectionRevision }],
    })
    expect(accepted.outcome).toBe('accepted')

    const rejected = placeFilingCommandResultV2Schema.parse({
      schemaVersion: 'place-filing-command-result.v2',
      outcome: 'rejected',
      commandId,
      rejection: { code: 'version-conflict' },
    })
    expect(rejected.outcome).toBe('rejected')
  })

  it('uses stable rejections without disclosing whether another member owns a Collection', () => {
    for (const rejection of [
      { code: 'not-found' },
      { code: 'version-conflict' },
      { code: 'operation-id-reused' },
      { code: 'invalid-selection' },
      { code: 'anchor-not-found' },
      { code: 'source-membership-missing' },
      { code: 'collection-limit-exceeded', limit: 50 },
      { code: 'binding-version-conflict' },
      { code: 'publication-changed' },
    ]) {
      expect(libraryOperationRejectionV2Schema.safeParse(rejection).success).toBe(true)
    }
    expect(libraryOperationRejectionV2Schema.safeParse({
      code: 'not-found',
      collectionId,
    }).success).toBe(false)
    expect(libraryOperationRejectionV2Schema.safeParse({
      code: 'collection-unavailable',
      collectionId,
    }).success).toBe(false)
  })

  it('orders Collection members only through stable anchors', () => {
    for (const anchor of [
      { kind: 'first' as const },
      { kind: 'last' as const },
      { kind: 'before' as const, placeId: secondPlaceId },
      { kind: 'after' as const, placeId: secondPlaceId },
    ]) {
      expect(collectionOrderCommandRequestV2Schema.safeParse({
        schemaVersion: 'collection-order-command.v2',
        commandId,
        collectionId,
        placeId,
        expectedCollectionRevision: collectionRevision,
        anchor,
      }).success).toBe(true)
    }
    expect(collectionOrderCommandRequestV2Schema.safeParse({
      schemaVersion: 'collection-order-command.v2',
      commandId,
      collectionId,
      placeId,
      expectedCollectionRevision: collectionRevision,
      position: 3,
      anchor: { kind: 'last' },
    }).success).toBe(false)
    expect(collectionOrderCommandRequestV2Schema.safeParse({
      schemaVersion: 'collection-order-command.v2',
      commandId,
      collectionId,
      placeId,
      expectedCollectionRevision: collectionRevision,
      anchor: { kind: 'before', placeId },
    }).success).toBe(false)

    const result = collectionOrderCommandResultV2Schema.parse({
      schemaVersion: 'collection-order-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId, status: 'replayed' },
      collectionId,
      placeId,
      collectionRevision: 'post-order-revision',
    })
    expect(result.outcome).toBe('accepted')
  })

  it('uses the same opaque revision for Collection lifecycle changes', () => {
    const create = collectionLifecycleCommandRequestV2Schema.parse({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'create', commandId, collectionId, name: ' 서울 라멘 ',
    })
    expect(create).toMatchObject({ name: '서울 라멘', description: null })
    expect(collectionLifecycleCommandRequestV2Schema.safeParse({
      schemaVersion: 'collection-lifecycle-command.v2',
      kind: 'update', commandId, collectionId,
      expectedCollectionRevision: collectionRevision,
    }).success).toBe(false)
    expect(collectionLifecycleCommandResultV2Schema.parse({
      schemaVersion: 'collection-lifecycle-command-result.v2',
      outcome: 'accepted',
      receipt: { commandId, status: 'applied' },
      collection: {
        collectionId, name: '서울 라멘', description: null, visibility: 'private',
        publicationId: null, placeCount: 0, collectionRevision,
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
    }).outcome).toBe('accepted')
  })
})
