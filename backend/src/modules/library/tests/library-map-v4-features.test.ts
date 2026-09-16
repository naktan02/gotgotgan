import { describe, expect, it } from 'vitest'

import { createLibraryMapV4Accumulator } from '../application/library-map-v4-features.js'

const collectionA = {
  collectionId: '01992d20-3000-7000-8000-000000000301',
  name: '성수',
  colorToken: 'fern' as const,
}
const collectionB = {
  collectionId: '01992d20-3000-7000-8000-000000000302',
  name: '을지로',
  colorToken: 'ocean' as const,
}

describe('Library map v4 feature projection', () => {
  it('counts distinct Places per Collection and keeps coincident membership previews', () => {
    const map = createLibraryMapV4Accumulator({
      bounds: { west: 126, south: 37, east: 128, north: 38 },
      zoom: 14,
      maxFeatures: 500,
    })
    map.add({ kind: 'place', placeId: '01992d20-3000-7000-8000-000000000201', label: '하나',
      location: { latitude: 37.54, longitude: 127.05 }, classification: null,
      memberships: [collectionA, collectionB] })
    map.add({ kind: 'place', placeId: '01992d20-3000-7000-8000-000000000202', label: '둘',
      location: { latitude: 37.54, longitude: 127.05 }, classification: null,
      memberships: [collectionA] })

    expect(map.finish()).toEqual([expect.objectContaining({
      kind: 'cluster',
      count: 2,
      coincidentPreview: expect.objectContaining({
        places: [expect.objectContaining({ memberships: [collectionA, collectionB] }),
          expect.objectContaining({ memberships: [collectionA] })],
        remainingCount: 0,
      }),
      collectionDistribution: [
        { collectionId: collectionA.collectionId, colorToken: 'fern', placeCount: 2 },
        { collectionId: collectionB.collectionId, colorToken: 'ocean', placeCount: 1 },
      ],
      remainingCollectionCount: 0,
    })])
  })

  it('reserves the selected Place outside the cluster feature budget', () => {
    const selectedPlaceId = '01992d20-3000-7000-8000-000000000201'
    const map = createLibraryMapV4Accumulator({
      bounds: { west: 126, south: 37, east: 128, north: 38 },
      zoom: 14,
      maxFeatures: 2,
      selectedPlaceId,
    })
    for (const [index, longitude] of [127.01, 127.5, 127.9].entries()) {
      map.add({ kind: 'place', placeId: `01992d20-3000-7000-8000-${String(201 + index).padStart(12, '0')}`,
        label: String(index), location: { latitude: 37.54, longitude }, classification: null,
        memberships: [collectionA] })
    }
    const features = map.finish()
    expect(features).toHaveLength(2)
    expect(features[0]).toMatchObject({ kind: 'place', placeId: selectedPlaceId })
    expect(features[1]).toMatchObject({ kind: 'cluster', count: 2 })
  })
})
