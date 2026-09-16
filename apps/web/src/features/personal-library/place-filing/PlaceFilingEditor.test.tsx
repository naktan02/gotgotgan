import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlaceFilingEditor } from './PlaceFilingEditor'
import type { PlaceFilingWorkflow } from './place-filing-workflow'

const noOperation = () => undefined

describe('Place filing editor', () => {
  it('shows simultaneous Collection memberships as the only favorite filing controls', () => {
    const workflow = {
      filing: {
        schemaVersion: 'place-filing.v2',
        placeId: '01992d20-3000-7000-8000-000000000001',
        overlay: { isFavorited: true, collectionCount: 2, personalRating: null },
        collections: [{
          collectionId: '01992d20-3000-7000-8000-000000000011',
          name: '서울 라멘', included: true, collectionRevision: 'revision-a',
        }, {
          collectionId: '01992d20-3000-7000-8000-000000000012',
          name: '도쿄 여행', included: true, collectionRevision: 'revision-b',
        }],
      },
      desired: {
        '01992d20-3000-7000-8000-000000000011': true,
        '01992d20-3000-7000-8000-000000000012': true,
      },
      loading: false,
      loadingMore: false,
      saving: false,
      message: undefined,
      dirtyCount: 0,
      toggle: noOperation,
      save: noOperation,
      retrySave: noOperation,
      retryLoad: noOperation,
      loadMore: noOperation,
    } as unknown as PlaceFilingWorkflow

    const markup = renderToStaticMarkup(<PlaceFilingEditor workflow={workflow} />)

    expect(markup).toContain('서울 라멘')
    expect(markup).toContain('도쿄 여행')
    expect(markup.match(/checked=""/g)).toHaveLength(2)
    expect(markup).toContain('한 장소를 여러 카테고리에 함께 담을 수 있습니다.')
    expect(markup).not.toContain('가고 싶음')
  })
})
