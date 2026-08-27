import { describe, expect, it } from 'vitest'

import {
  libraryCollectionDetailResponseSchema,
  libraryPlaceListQuerySchema,
  libraryPlaceListResponseSchema,
  libraryTagListResponseSchema,
} from '../src/library/index.js'
import { libraryCommandRequestSchema } from '../src/http/index.js'

const placeId = '01992d20-3000-7000-8000-000000000001'

describe('bounded library query contracts', () => {
  it('defaults to a bounded saved-place page and rejects unbounded limits', () => {
    expect(libraryPlaceListQuerySchema.parse({})).toEqual({
      state: 'saved', tagIds: [], tagMatch: 'all', limit: 20,
    })
    expect(libraryPlaceListQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(libraryPlaceListQuerySchema.parse({ tagIds: placeId })).toMatchObject({
      tagIds: [placeId], tagMatch: 'all',
    })
    expect(libraryPlaceListQuerySchema.safeParse({ tagIds: [placeId, placeId] }).success).toBe(false)
  })

  it('keeps an owned preference when its public place projection is unavailable', () => {
    const page = libraryPlaceListResponseSchema.parse({
      schemaVersion: 'library-place-list.v2',
      filter: { state: 'saved', tagIds: [], tagMatch: 'all' },
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

  it('accepts the complete manual Collection and Tag lifecycle', () => {
    const commandId = '01992d20-3000-7000-8000-000000000010'
    const collectionId = '01992d20-3000-7000-8000-000000000011'
    const tagId = '01992d20-3000-7000-8000-000000000012'
    for (const command of [
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
