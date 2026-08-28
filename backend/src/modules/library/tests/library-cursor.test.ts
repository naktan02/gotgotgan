import { describe, expect, it } from 'vitest'

import {
  decodePlaceCursor,
  encodePlaceCursor,
} from '../application/library-cursor.js'
import { InvalidLibraryCursorError } from '../domain/queries.js'

describe('Library Place cursor', () => {
  it('binds maximum filter arrays through a compact fingerprint', () => {
    const filter = {
      state: 'saved' as const,
      tagIds: Array.from(
        { length: 20 },
        (_, index) => `01992d20-3000-7000-8000-${String(index).padStart(12, '0')}`,
      ),
      tagMatch: 'all' as const,
      areaKeys: Array.from(
        { length: 10 },
        (_, index) => `area_${String(index).padStart(22, 'a')}`,
      ),
      taxonomyKeys: Array.from(
        { length: 10 },
        (_, index) => `${'t'.repeat(126)}${String(index).padStart(2, '0')}`,
      ),
    }
    const position = {
      updatedAt: '2026-08-28T00:00:00.000Z',
      placeId: '01992d20-3000-7000-8000-000000000099',
    }

    const cursor = encodePlaceCursor(filter, position)

    expect(cursor.length).toBeLessThan(2_048)
    expect(decodePlaceCursor(cursor, filter)).toEqual(position)
    expect(() => decodePlaceCursor(cursor, {
      ...filter,
      taxonomyKeys: [...filter.taxonomyKeys.slice(0, -1), 'food.cafe'],
    })).toThrow(InvalidLibraryCursorError)
  })
})
