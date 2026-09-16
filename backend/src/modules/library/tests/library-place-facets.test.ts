import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  buildLibraryPlaceFacets,
  libraryAreaFacetKey,
  matchesLibraryPlaceFacets,
} from '../application/library-place-facets.js'
import { listPostgresLibraryPlaces } from '../adapters/persistence/queries/index.js'
import type { LibraryPlaceSummary } from '../domain/queries.js'

const summary = (
  placeId: string,
  areaLabel: string | null,
  taxonomy: Readonly<{ key: string; label: string }> | null,
): LibraryPlaceSummary => ({
  placeId,
  name: placeId,
  areaLabel,
  location: { latitude: 37.5, longitude: 127 },
  primaryTaxonomy: taxonomy,
  taxonomyKeys: taxonomy === null ? [] : [taxonomy.key],
  evidence: { status: 'verified', projectedAt: '2026-08-28T00:00:00.000Z' },
})

describe('saved Place facets', () => {
  it('normalizes equivalent area labels into one stable key and ranks member counts', () => {
    const first = summary('place-1', ' 서울  성동구 ', { key: 'food.noodle.ramen', label: '라멘' })
    const second = summary('place-2', '서울 성동구', { key: 'food.cafe', label: '카페' })
    const facets = buildLibraryPlaceFacets({
      summaries: [first, second], savedPlaceCount: 3, sampledPlaceCount: 3,
    })

    expect(facets.areas).toEqual([{
      key: libraryAreaFacetKey('서울 성동구'), label: '서울 성동구', count: 2,
    }])
    expect(facets.taxonomies.map((facet) => facet.key)).toEqual([
      'food.cafe', 'food.noodle.ramen',
    ])
    expect(facets.coverage).toEqual({
      savedPlaceCount: 3, sampledPlaceCount: 3, projectedPlaceCount: 2, complete: true,
    })
  })

  it('requires a projection only when an area or taxonomy filter is selected', () => {
    const place = summary('place-1', '성수동', { key: 'food.noodle.ramen', label: '라멘' })
    expect(matchesLibraryPlaceFacets(undefined, { areaKeys: [], taxonomyKeys: [] })).toBe(true)
    expect(matchesLibraryPlaceFacets(place, {
      areaKeys: [libraryAreaFacetKey('성수동')], taxonomyKeys: ['food.noodle.ramen'],
    })).toBe(true)
    expect(matchesLibraryPlaceFacets(place, {
      areaKeys: [libraryAreaFacetKey('을지로')], taxonomyKeys: [],
    })).toBe(false)
  })

  it('returns a continuation after a bounded scan with no facet matches', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      canonical_place_id: `01992d20-3000-7000-8000-${String(index).padStart(12, '0')}`,
      saved: true,
      wanted: false,
      personal_rating: null,
      updated_at: new Date(1_800_000_000_000 - index),
    }))
    const query = vi.fn(async (_text: string, _values: unknown[]) => ({ rows }))
    const readSummaries = vi.fn(async (
      _placeIds: readonly string[],
    ): Promise<readonly LibraryPlaceSummary[]> => [])

    const page = await listPostgresLibraryPlaces(
      { query } as unknown as Pool,
      readSummaries,
      {
        memberId: '01992d20-3000-7000-8000-000000009999',
        state: 'saved', tagIds: [], tagMatch: 'all',
        areaKeys: [libraryAreaFacetKey('없는 지역')], taxonomyKeys: [], limit: 20,
      },
    )

    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeTypeOf('string')
    expect(readSummaries.mock.calls[0]?.[0]).toHaveLength(500)
    expect(query.mock.calls[0]?.[1]?.at(-1)).toBe(501)
  })
})
