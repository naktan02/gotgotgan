import { describe, expect, it } from 'vitest'
import { matchProductTaxonomyLabel } from '../index.js'

describe('product-owned classification labels', () => {
  it('matches exact labels without guessing provider categories, collection names or synonyms', () => {
    expect(matchProductTaxonomyLabel(' 쇼유라멘 ')).toEqual({ key: 'food.noodle.ramen.shoyu', label: '쇼유라멘' })
    expect(matchProductTaxonomyLabel('라멘')).toMatchObject({ key: 'food.noodle.ramen' })
    for (const label of ['내 라멘 맛집', '일식 > 라멘', '라면', '아이와 가기 좋은 곳', 'shoyu ramen', '']) {
      expect(matchProductTaxonomyLabel(label)).toBeUndefined()
    }
  })
})
