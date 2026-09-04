import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TagManagementView } from './TagManagementPanel'
import type { TagManagementWorkflow } from './tag-management-workflow'

describe('Tag management view', () => {
  it('offers accessible creation and rename controls with place counts', () => {
    const workflow = {
      tags: [{
        tagId: '11111111-1111-4111-8111-111111111111',
        name: '아이와 함께',
        placeCount: 3,
        createdAt: '2026-09-05T00:00:00.000Z',
      }],
      nextCursor: undefined,
      loading: false,
      loadingMore: false,
      error: undefined,
      mutationKey: undefined,
      createDraft: '',
      editingTagId: undefined,
      deleteArmedTagId: undefined,
      renameDraft: '',
      setCreateDraft: () => undefined,
      setRenameDraft: () => undefined,
      createTag: () => Promise.resolve(),
      beginRename: () => undefined,
      cancelRename: () => undefined,
      renameTag: () => Promise.resolve(),
      armDelete: () => undefined,
      cancelDelete: () => undefined,
      deleteTag: () => Promise.resolve(),
      retry: () => Promise.resolve(),
      loadMore: () => undefined,
    } as unknown as TagManagementWorkflow

    const markup = renderToStaticMarkup(<TagManagementView workflow={workflow} />)

    expect(markup).toContain('새 태그')
    expect(markup).toContain('아이와 함께')
    expect(markup).toContain('장소 3개')
    expect(markup).toContain('이름 변경')
    expect(markup).toContain('아이와 함께 태그 삭제')
    expect(markup).not.toContain('삭제 확인')
  })

  it('requires a second explicit action before deleting a tag', () => {
    const workflow = {
      tags: [{
        tagId: '11111111-1111-4111-8111-111111111111',
        name: '아이와 함께',
        placeCount: 3,
        createdAt: '2026-09-05T00:00:00.000Z',
      }],
      nextCursor: undefined,
      loading: false,
      loadingMore: false,
      error: undefined,
      mutationKey: undefined,
      createDraft: '',
      editingTagId: undefined,
      deleteArmedTagId: '11111111-1111-4111-8111-111111111111',
      renameDraft: '',
      setCreateDraft: () => undefined,
      setRenameDraft: () => undefined,
      createTag: () => Promise.resolve(),
      beginRename: () => undefined,
      cancelRename: () => undefined,
      renameTag: () => Promise.resolve(),
      armDelete: () => undefined,
      cancelDelete: () => undefined,
      deleteTag: () => Promise.resolve(),
      retry: () => Promise.resolve(),
      loadMore: () => undefined,
    } as unknown as TagManagementWorkflow

    const markup = renderToStaticMarkup(<TagManagementView workflow={workflow} />)

    expect(markup).toContain('삭제 확인')
    expect(markup).toContain('취소')
  })
})
