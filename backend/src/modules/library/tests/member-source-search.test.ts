import { describe, expect, it, vi } from 'vitest'

import { matchesFavorite, summariesById } from '../adapters/persistence/collection-first/favorite-read.js'
import type { LibraryPlaceSummary } from '../domain/queries.js'

const summary: LibraryPlaceSummary = {
  placeId: 'place-1', name: '공개 이름', areaLabel: null,
  location: { latitude: 37.54, longitude: 127.05 }, primaryTaxonomy: null, taxonomyKeys: [],
  evidence: { status: 'unverified', projectedAt: '2026-09-06T00:00:00.000Z' },
}
const row = { canonical_place_id: 'place-1', source_position: 0, collection_count: 1, tag_ids: [], tag_names: ['혼밥'], personal_rating: null }
const query = { areaKeys: [], taxonomyKeys: [], placeQuery: '성수동 쇼유라멘' }

describe('owner-only source text for personal Collection search', () => {
  it('supplements a public summary without replacing public fields or exposing private search text as summary', async () => {
    const readMember = vi.fn(async () => [{ summary: { ...summary, name: '개인 별명' },
      sourceObservedSearchText: '서울 성수동 원문분류>쇼유라멘' }])
    const reads = await summariesById(async () => [summary], ['place-1'], 'owner', readMember)
    expect(readMember).toHaveBeenCalledWith('owner', ['place-1'])
    const read = reads.get('place-1')
    expect(read?.summary).toEqual(summary)
    expect(read?.summary).not.toHaveProperty('sourceObservedSearchText')
    expect(matchesFavorite(row, read, query)).toBe(true)
    expect(matchesFavorite(row, read, { ...query, placeQuery: '성수동 혼밥' })).toBe(true)
    expect(matchesFavorite(row, read, { ...query, taxonomyKeys: ['raw.쇼유라멘'] })).toBe(false)
  })

  it('uses owner fallback when public facts are absent and drops unrequested member rows', async () => {
    const own = { summary, sourceObservedSearchText: '성수동 쇼유라멘' }
    const reads = await summariesById(async () => [], ['place-1'], 'owner', async () => [
      own, { ...own, summary: { ...summary, placeId: 'not-requested' } },
    ])
    expect([...reads.keys()]).toEqual(['place-1'])
    expect(reads.get('place-1')).toEqual(own)
  })

  it('does not match another member source when the authenticated reader returns no owned provenance', async () => {
    const readMember = vi.fn(async () => [])
    const reads = await summariesById(async () => [summary], ['place-1'], 'other-member', readMember)
    expect(readMember).toHaveBeenCalledWith('other-member', ['place-1'])
    expect(matchesFavorite(row, reads.get('place-1'), query)).toBe(false)
    expect(matchesFavorite(row, reads.get('place-1'), { ...query, placeQuery: '공개 이름' })).toBe(true)
  })
})
