import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CollectionManagementView } from './CollectionManagementPanel'
import type { CollectionManagementWorkflow } from './collection-management-workflow'

describe('Collection management view', () => {
  it('shows explicit publication choices, a safe share target, and ordered place actions', () => {
    const workflow = {
      visibility: 'unlisted',
      sharePath: '/share/collections/11111111-1111-4111-8111-111111111111',
      mutationKey: undefined,
      copyMessage: undefined,
      loading: false,
      loadingMore: false,
      error: undefined,
      nextCursor: undefined,
      removeArmedPlaceId: undefined,
      places: [{
        placeId: '22222222-2222-4222-8222-222222222222',
        position: 0,
        addedAt: '2026-09-05T00:00:00.000Z',
        place: null,
      }],
      setVisibility: () => Promise.resolve(),
      copyShareLink: () => Promise.resolve(),
      movePlace: () => Promise.resolve(),
      removePlace: () => Promise.resolve(),
      armRemove: () => undefined,
      cancelRemove: () => undefined,
      retry: () => Promise.resolve(),
      loadMore: () => undefined,
    } as unknown as CollectionManagementWorkflow

    const markup = renderToStaticMarkup(
      <CollectionManagementView collectionName="도쿄 여행" workflow={workflow} />,
    )

    expect(markup).toContain('나만 보기')
    expect(markup).toContain('링크 공개')
    expect(markup).toContain('전체 공개')
    expect(markup).toContain('rel="noreferrer"')
    expect(markup).toContain('카테고리에서 제외')
    expect(markup).not.toContain('저장됨')
    expect(markup).not.toContain('가고 싶음')
  })
})
