import { describe, expect, it } from 'vitest'

import {
  collectionColorCommandRequestV1Schema,
  collectionColorCommandResultV1Schema,
  collectionColorTokenSchema,
  personalLibraryMapHttpQueryV4Schema,
  personalLibraryMapResponseV3Schema,
  personalLibraryMapResponseV4Schema,
} from '../src/library/index.js'

const id = (index: number) => `01992d20-4000-7000-8000-${String(index).padStart(12, '0')}`
const bounds = { west: 126, south: 37, east: 128, north: 38 }
const collection = (index: number, colorToken = 'fern') => ({
  collectionId: id(index), name: `목록 ${index}`, colorToken,
})
const place = {
  kind: 'place' as const,
  placeId: id(201),
  label: '옥동식',
  location: { latitude: 37.55, longitude: 126.91 },
  classification: null,
  memberships: [collection(1), collection(2, 'ocean')],
}
const response = {
  schemaVersion: 'personal-library-map.v4',
  selection: { kind: 'collections', collectionIds: [id(1), id(2)] },
  filter: { ratingFilter: { kind: 'any' }, tagIds: [], tagMatch: 'all', areaKeys: [], taxonomyKeys: [] },
  selectedCollections: [collection(1), collection(2, 'ocean')],
  viewport: { bounds, zoom: 14 },
  features: [place],
  coverage: { representedPlaceCount: 1, unprojectedPlaceCount: 0, complete: true },
}

describe('multi-Collection Personal Library map contract', () => {
  it('accepts an explicit all-favorites scope or a unique bounded Collection selection', () => {
    expect(personalLibraryMapHttpQueryV4Schema.safeParse({ ...bounds, zoom: 14, scope: 'all' }).success).toBe(true)
    expect(personalLibraryMapHttpQueryV4Schema.safeParse({
      ...bounds, zoom: 14, scope: 'collections', collectionIds: [id(1), id(2)], selectedPlaceId: id(201),
    }).success).toBe(true)
    expect(personalLibraryMapResponseV4Schema.safeParse(response).success).toBe(true)
  })

  it('rejects empty, duplicate, and oversized explicit Collection selections', () => {
    for (const collectionIds of [
      [],
      [id(1), id(1)],
      Array.from({ length: 101 }, (_, index) => id(index + 1)),
    ]) expect(personalLibraryMapHttpQueryV4Schema.safeParse({
      ...bounds, zoom: 14, scope: 'collections', collectionIds,
    }).success).toBe(false)
    expect(personalLibraryMapHttpQueryV4Schema.safeParse({
      ...bounds, zoom: 14, scope: 'all', collectionIds: [id(1)],
    }).success).toBe(false)
  })

  it('keeps palette and membership data strict, selected, and private-field free', () => {
    expect(collectionColorTokenSchema.safeParse('fern').success).toBe(true)
    expect(collectionColorTokenSchema.safeParse('#00ff00').success).toBe(false)
    expect(personalLibraryMapResponseV4Schema.safeParse({
      ...response,
      selectedCollections: [collection(1, '#00ff00')],
    }).success).toBe(false)
    expect(personalLibraryMapResponseV4Schema.safeParse({
      ...response,
      features: [{ ...place, memberships: [collection(3)] }],
    }).success).toBe(false)
    expect(personalLibraryMapResponseV4Schema.safeParse({
      ...response,
      features: [{ ...place, memberships: [{ ...collection(1), personalRating: 5 }] }],
    }).success).toBe(false)
  })

  it('uses a separate revision-aware command for Collection colors', () => {
    const command = {
      schemaVersion: 'collection-color-command.v1',
      commandId: id(301),
      collectionId: id(1),
      expectedCollectionRevision: 'collection-revision',
      colorToken: 'coral',
    }
    expect(collectionColorCommandRequestV1Schema.safeParse(command).success).toBe(true)
    expect(collectionColorCommandRequestV1Schema.safeParse({ ...command, colorToken: '#ff0000' }).success).toBe(false)
    expect(collectionColorCommandRequestV1Schema.safeParse({ ...command, personalNote: 'private' }).success).toBe(false)
    expect(collectionColorCommandResultV1Schema.safeParse({
      schemaVersion: 'collection-color-command-result.v1',
      outcome: 'accepted',
      receipt: { commandId: command.commandId, status: 'applied' },
      collectionId: command.collectionId,
      collectionRevision: 'next-revision',
      colorToken: command.colorToken,
    }).success).toBe(true)
  })

  it('does not widen the frozen v3 response', () => {
    expect(personalLibraryMapResponseV3Schema.safeParse({
      ...response,
      schemaVersion: 'personal-library-map.v3',
    }).success).toBe(false)
  })
})
