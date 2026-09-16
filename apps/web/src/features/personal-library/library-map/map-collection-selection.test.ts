import { describe, expect, it } from 'vitest'

import { toggleMapCollectionSelection } from './map-collection-selection'

describe('Library map Collection selection', () => {
  it('removes one Collection from the full selection without reversing its meaning', () => {
    expect(toggleMapCollectionSelection(
      { kind: 'all' },
      'collection-2',
      ['collection-1', 'collection-2', 'collection-3'],
    )).toEqual({ kind: 'collections', collectionIds: ['collection-1', 'collection-3'] })
  })

  it('supports a truly cleared overlay and selecting from it again', () => {
    expect(toggleMapCollectionSelection(
      { kind: 'collections', collectionIds: ['collection-1'] },
      'collection-1',
      ['collection-1'],
    )).toEqual({ kind: 'none' })
    expect(toggleMapCollectionSelection(
      { kind: 'none' },
      'collection-1',
      ['collection-1'],
    )).toEqual({ kind: 'collections', collectionIds: ['collection-1'] })
  })
})
