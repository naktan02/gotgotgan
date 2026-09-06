import { describe, expect, it } from 'vitest'
import { interpretLibraryQuery, type LibraryQueryCondition } from './library-query'

const vocabulary: LibraryQueryCondition[] = [
  { kind: 'area', key: 'verified-area', label: '성수동' },
  { kind: 'taxonomy', key: 'verified-food', label: '쇼유라멘' },
  { kind: 'tag', key: 'member-tag', label: '진한 국물' },
]
const empty = { areaKeys: [], taxonomyKeys: [], tagIds: [] }

describe('Favorite-scope query interpretation', () => {
  it('uses only provided identities, leaves name/address text, and requires explicit personal tags', () => {
    const result = interpretLibraryQuery('성수동 쇼유라멘 멘야 #진한 국물', vocabulary, empty)
    expect(result.text).toBe('멘야')
    expect(result.filters).toEqual({ areaKeys: ['verified-area'], taxonomyKeys: ['verified-food'], tagIds: ['member-tag'] })
    expect(interpretLibraryQuery('진한 국물', vocabulary, empty).conditions).toHaveLength(0)
  })
  it('does not invent partial food classifications or infer unknown attributes', () => {
    const result = interpretLibraryQuery('라멘 아이동반', vocabulary, empty)
    expect(result.text).toBe('라멘 아이동반')
    expect(result.conditions).toHaveLength(0)
    expect(interpretLibraryQuery('성수동라멘', vocabulary, empty).conditions).toHaveLength(0)
  })
  it('does not turn identical labels into a guessed identity and respects contract limits', () => {
    expect(interpretLibraryQuery('쇼유라멘', [...vocabulary, { ...vocabulary[1], key: 'other-food' }], empty).conditions).toHaveLength(0)
    const result = interpretLibraryQuery('쇼유라멘', vocabulary, { ...empty, taxonomyKeys: Array.from({ length: 10 }, (_, index) => `manual-${index}`) })
    expect(result.conditions).toHaveLength(0)
    expect(result.text).toBe('쇼유라멘')
  })
  it('handles regex characters in real member tags', () => {
    const result = interpretLibraryQuery('#C++', [{ kind: 'tag', key: 'tag', label: 'C++' }], empty)
    expect(result.filters.tagIds).toEqual(['tag'])
    expect(result.text).toBe('')
  })
})
