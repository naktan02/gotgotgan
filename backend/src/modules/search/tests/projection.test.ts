import { describe, expect, it } from 'vitest'

import {
  InvalidLocalSearchProjectionError,
  projectLocalPlace,
  projectMemberSearchSignal,
  type LocalSearchProjectionStore,
} from '../index.js'

describe('Local Search Projection interface', () => {
  it('accepts provider-neutral place facts and member signals independently', async () => {
    const observed: unknown[] = []
    const store: LocalSearchProjectionStore = {
      upsertPlace: async (document) => { observed.push(document) },
      upsertMemberSignal: async (signal) => { observed.push(signal) },
    }

    await projectLocalPlace({
      placeId: '01992d20-0000-7000-8000-000000000101',
      sourceVersion: 3,
      name: '조용한 라멘 연구소',
      areaLabel: '성수',
      latitude: 37.5445,
      longitude: 127.056,
      primaryTaxonomy: { key: 'food.noodle.ramen', label: '라멘' },
      taxonomyKeys: ['food.noodle.ramen', 'mood.quiet'],
      evidenceStatus: 'verified',
      projectedAt: '2026-08-26T00:00:00.000Z',
    }, store)
    await projectMemberSearchSignal({
      memberId: '01992d20-0000-7000-8000-000000000201',
      placeId: '01992d20-0000-7000-8000-000000000101',
      sourceVersion: 5,
      saved: true,
      wanted: false,
      visited: true,
      personalRating: 4.4,
      projectedAt: '2026-08-26T00:00:00.000Z',
    }, store)

    expect(observed).toHaveLength(2)
    expect(observed[1]).toMatchObject({ personalRating: 4.4, visited: true })
  })

  it('rejects invalid ratings before persistence', async () => {
    const store: LocalSearchProjectionStore = {
      upsertPlace: async () => undefined,
      upsertMemberSignal: async () => undefined,
    }
    await expect(projectMemberSearchSignal({
      memberId: 'member', placeId: 'place', sourceVersion: 1,
      saved: false, wanted: false, visited: false, personalRating: 5.01,
      projectedAt: '2026-08-26T00:00:00.000Z',
    }, store)).rejects.toBeInstanceOf(InvalidLocalSearchProjectionError)
  })
})
