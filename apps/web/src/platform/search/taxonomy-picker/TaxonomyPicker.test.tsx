import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TaxonomyNode } from '@place/contracts/search'
import { TaxonomyPickerView } from './TaxonomyPicker'
import { taxonomyCandidates, taxonomyTrail } from './taxonomy-navigation'

const nodes: TaxonomyNode[] = [
  { key: 'food', parentKey: null, label: '음식점', kind: 'category', version: 1 },
  { key: 'ramen', parentKey: 'food', label: '라멘', kind: 'category', version: 1 },
  { key: 'shoyu', parentKey: 'ramen', label: '쇼유라멘', kind: 'attribute', version: 1 },
  { key: 'park', parentKey: null, label: '공원', kind: 'category', version: 1 },
]
const noop = () => undefined

describe('Taxonomy picker', () => {
  it('uses actual parent keys and shows only the current level until a branch is entered', () => {
    expect(taxonomyCandidates(nodes, null, '').map((node) => node.key)).toEqual(['food', 'park'])
    expect(taxonomyCandidates(nodes, 'food', '').map((node) => node.key)).toEqual(['ramen'])
    expect(taxonomyTrail(nodes, 'shoyu').map((node) => node.label)).toEqual(['음식점', '라멘', '쇼유라멘'])
    const markup = renderToStaticMarkup(<TaxonomyPickerView nodes={nodes} status="ready" onSelect={noop} onClose={noop} onRetry={noop} />)
    expect(markup).toContain('음식점 하위 분류 보기')
    expect(markup).not.toContain('쇼유라멘 선택')
    expect(markup).toContain('공원 선택')
  })
  it('searches descendants without escaping the current branch or inventing missing ancestry', () => {
    expect(taxonomyCandidates(nodes, 'food', '라멘').map((node) => node.key)).toEqual(['ramen', 'shoyu'])
    expect(taxonomyCandidates(nodes, 'park', '라멘')).toEqual([])
    expect(taxonomyTrail(nodes, 'missing')).toEqual([])
  })
  it('bounds rendered candidates and keeps empty projections honest', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ ...nodes[0], key: `category-${index}`, label: `분류 ${index}` }))
    const markup = renderToStaticMarkup(<TaxonomyPickerView nodes={many} status="ready" onSelect={noop} onClose={noop} onRetry={noop} />)
    expect((markup.match(/<li>/g) ?? [])).toHaveLength(12)
    expect(markup).toContain('분류 더 보기 (12/300)')
    const empty = renderToStaticMarkup(<TaxonomyPickerView nodes={[]} status="ready" onSelect={noop} onClose={noop} onRetry={noop} />)
    expect(empty).toContain('세부 분류 준비 중')
    expect(empty).toContain('검색어로 찾기')
    expect(empty).not.toContain('음식점 하위 분류 보기')
  })
})
