import { describe, expect, it } from 'vitest'

import {
  libraryCollectionDetailResponseSchema,
  libraryMapQuerySchema,
  libraryMapResponseSchema,
  libraryPlaceFacetsResponseSchema,
  libraryPlaceFacetsQuerySchema,
  libraryPlaceOrganizationQuerySchema,
  libraryPlaceOrganizationResponseSchema,
  libraryPlaceListQuerySchema,
  libraryPlaceListResponseSchema,
  libraryTagListResponseSchema,
} from '../src/library/index.js'
import { libraryCommandRequestSchema } from '../src/http/index.js'

const placeId = '01992d20-3000-7000-8000-000000000001'

describe('bounded library query contracts', () => {
  it('defaults to a bounded saved-place page and rejects unbounded limits', () => {
    expect(libraryPlaceListQuerySchema.parse({})).toEqual({
      state: 'saved', tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [], limit: 20,
    })
    expect(libraryPlaceListQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(libraryPlaceListQuerySchema.parse({ tagIds: placeId })).toMatchObject({
      tagIds: [placeId], tagMatch: 'all',
    })
    expect(libraryPlaceListQuerySchema.safeParse({ tagIds: [placeId, placeId] }).success).toBe(false)
  })

  it('keeps an owned preference when its public place projection is unavailable', () => {
    const page = libraryPlaceListResponseSchema.parse({
      schemaVersion: 'library-place-list.v3',
      filter: { state: 'saved', tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
      items: [{
        placeId,
        saved: true,
        wanted: false,
        personalRating: null,
        updatedAt: '2026-08-28T00:00:00.000Z',
        place: null,
      }],
    })
    expect(page.items[0]?.place).toBeNull()
  })

  it('separates a viewport map projection from bounded list pages', () => {
    expect(libraryMapQuerySchema.parse({
      scope: 'state', west: '126.9', south: '37.5', east: '127.1', north: '37.6', zoom: '12',
    })).toEqual({
      scope: 'state', state: 'saved', tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [],
      west: 126.9, south: 37.5, east: 127.1, north: 37.6, zoom: 12,
    })
    expect(libraryMapQuerySchema.safeParse({
      scope: 'state', west: 127.1, south: 37.5, east: 126.9, north: 37.6, zoom: 12,
    }).success).toBe(false)
    expect(libraryMapQuerySchema.safeParse({
      scope: 'collection', collectionId: placeId, tagIds: placeId,
      west: 126.9, south: 37.5, east: 127.1, north: 37.6, zoom: 12,
    }).success).toBe(false)

    const projection = libraryMapResponseSchema.parse({
      schemaVersion: 'library-map-projection.v1',
      scope: {
        kind: 'state', state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [], taxonomyKeys: [],
      },
      viewport: {
        bounds: { west: 126.9, south: 37.5, east: 127.1, north: 37.6 }, zoom: 12,
      },
      features: [{
        kind: 'cluster', clusterId: 'z12-x1-y1', count: 3,
        location: { latitude: 37.55, longitude: 126.95 },
        bounds: { west: 126.94, south: 37.54, east: 126.96, north: 37.56 },
      }],
      coverage: { representedPlaceCount: 3, unprojectedPlaceCount: 0, complete: true },
    })
    expect(projection.features[0]).toMatchObject({ kind: 'cluster', count: 3 })
    expect(libraryMapResponseSchema.safeParse({
      ...projection,
      coverage: { representedPlaceCount: 2, unprojectedPlaceCount: 0, complete: true },
    }).success).toBe(false)
  })

  it('accepts only bounded saved-Place facet coverage and stable keys', () => {
    expect(libraryPlaceFacetsQuerySchema.safeParse({ memberId: placeId }).success).toBe(false)
    expect(libraryPlaceFacetsResponseSchema.parse({
      schemaVersion: 'library-place-facets.v1',
      sourceState: 'saved',
      coverage: {
        savedPlaceCount: 3, sampledPlaceCount: 3, projectedPlaceCount: 2, complete: true,
      },
      areas: [{ key: 'area_abcdefghijklmnopqrstuv', label: '서울 성동구', count: 2 }],
      taxonomies: [{ key: 'food.noodle.ramen', label: '라멘', count: 1 }],
    }).sourceState).toBe('saved')
    expect(libraryPlaceListQuerySchema.parse({
      areaKeys: 'area_abcdefghijklmnopqrstuv', taxonomyKeys: 'food.noodle.ramen',
    })).toMatchObject({
      areaKeys: ['area_abcdefghijklmnopqrstuv'], taxonomyKeys: ['food.noodle.ramen'],
    })
    expect(libraryPlaceListQuerySchema.safeParse({ areaKeys: '서울 성동구' }).success).toBe(false)
  })

  it('accepts the complete manual Collection and Tag lifecycle', () => {
    const commandId = '01992d20-3000-7000-8000-000000000010'
    const collectionId = '01992d20-3000-7000-8000-000000000011'
    const tagId = '01992d20-3000-7000-8000-000000000012'
    for (const command of [
      { kind: 'add-collection-place', collectionId, placeId },
      { kind: 'rename-collection', collectionId, name: '성수 라멘' },
      { kind: 'move-collection-place', collectionId, placeId, position: 1 },
      { kind: 'remove-collection-place', collectionId, placeId },
      { kind: 'delete-collection', collectionId },
      { kind: 'rename-tag', tagId, name: '쇼유라멘' },
      { kind: 'untag-place', tagId, placeId },
      { kind: 'delete-tag', tagId },
    ]) {
      expect(libraryCommandRequestSchema.safeParse({ commandId, command }).success).toBe(true)
    }
  })

  it('requires the observed preference version for a goal-state update', () => {
    const request = {
      commandId: '01992d20-3000-7000-8000-000000000010',
      command: {
        kind: 'set-place-preferences' as const,
        placeId,
        expectedUpdatedAt: '2026-08-28T00:00:00.000Z',
        saved: true,
        wanted: false,
        personalRating: 4.5,
      },
    }
    expect(libraryCommandRequestSchema.parse(request)).toEqual(request)
    expect(libraryCommandRequestSchema.safeParse({
      ...request,
      command: { ...request.command, expectedUpdatedAt: undefined },
    }).success).toBe(false)
    expect(libraryCommandRequestSchema.safeParse({
      ...request,
      command: { ...request.command, expectedUpdatedAt: null },
    }).success).toBe(true)
    expect(libraryCommandRequestSchema.parse({
      ...request,
      command: { ...request.command, expectedUpdatedAt: '2026-08-28T09:00:00+09:00' },
    }).command).toMatchObject({ expectedUpdatedAt: '2026-08-28T00:00:00.000Z' })
  })

  it('bounds the selected Place organization projection', () => {
    expect(libraryPlaceOrganizationQuerySchema.parse({})).toEqual({ limit: 20 })
    expect(libraryPlaceOrganizationQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(libraryPlaceOrganizationResponseSchema.parse({
      schemaVersion: 'library-place-organization.v1',
      placeId,
      items: [{
        kind: 'collection',
        collectionId: '01992d20-3000-7000-8000-000000000002',
        name: '성수동',
        selected: true,
        position: 3,
      }, {
        kind: 'tag',
        tagId: '01992d20-3000-7000-8000-000000000003',
        name: '쇼유라멘',
        selected: false,
      }],
    }).items).toHaveLength(2)
    expect(libraryPlaceOrganizationResponseSchema.safeParse({
      schemaVersion: 'library-place-organization.v1',
      placeId,
      items: [{
        kind: 'collection',
        collectionId: '01992d20-3000-7000-8000-000000000002',
        name: '성수동',
        selected: false,
        position: 3,
      }],
    }).success).toBe(false)
  })

  it('bounds collection places and tag summaries', () => {
    expect(libraryCollectionDetailResponseSchema.parse({
      schemaVersion: 'library-collection-detail.v1',
      collection: {
        collectionId: '01992d20-3000-7000-8000-000000000002',
        name: '성수', description: null, visibility: 'private', publicationId: null,
        placeCount: 1, updatedAt: '2026-08-28T00:00:00.000Z',
      },
      places: [{ placeId, position: 0, addedAt: '2026-08-28T00:00:00.000Z', place: null }],
    }).places).toHaveLength(1)

    expect(libraryTagListResponseSchema.parse({
      schemaVersion: 'library-tag-list.v1',
      items: [{
        tagId: '01992d20-3000-7000-8000-000000000003',
        name: '혼밥', placeCount: 2, createdAt: '2026-08-28T00:00:00.000Z',
      }],
    }).items[0]?.placeCount).toBe(2)
  })
})
