'use client'

import styles from './tag-management.module.css'
import {
  useTagManagementWorkflow,
  type TagManagementWorkflow,
} from './tag-management-workflow'

type PanelProperties = Readonly<{
  onAccessFailure: (status: number) => void
  onChanged: (deletedTagId?: string) => Promise<unknown>
}>

export function TagManagementView({ workflow }: Readonly<{ workflow: TagManagementWorkflow }>) {
  const busy = workflow.mutationKey !== undefined

  return (
    <details className={styles.panel}>
      <summary>태그 관리</summary>
      <div aria-busy={busy} className={styles.content}>
        <form
          className={styles.createForm}
          onSubmit={(event) => {
            event.preventDefault()
            void workflow.createTag()
          }}
        >
          <label htmlFor="tag-management-create">새 태그</label>
          <div>
            <input
              id="tag-management-create"
              maxLength={64}
              onChange={(event) => workflow.setCreateDraft(event.target.value)}
              placeholder="예: 아이와 함께"
              value={workflow.createDraft}
            />
            <button disabled={busy || workflow.createDraft.trim().length === 0} type="submit">
              {workflow.mutationKey === 'create' ? '만드는 중…' : '만들기'}
            </button>
          </div>
        </form>

        {workflow.loading ? (
          <p role="status">태그를 불러오는 중…</p>
        ) : workflow.tags.length === 0 ? (
          <p>아직 만든 태그가 없습니다.</p>
        ) : (
          <ul className={styles.tagList}>
            {workflow.tags.map((tag) => {
              const editing = workflow.editingTagId === tag.tagId
              const deleting = workflow.deleteArmedTagId === tag.tagId
              return (
                <li key={tag.tagId}>
                  {editing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void workflow.renameTag()
                      }}
                    >
                      <label htmlFor={`tag-rename-${tag.tagId}`}>{tag.name} 이름 변경</label>
                      <input
                        id={`tag-rename-${tag.tagId}`}
                        maxLength={64}
                        onChange={(event) => workflow.setRenameDraft(event.target.value)}
                        value={workflow.renameDraft}
                      />
                      <button
                        disabled={busy || workflow.renameDraft.trim().length === 0 || workflow.renameDraft.trim() === tag.name}
                        type="submit"
                      >저장</button>
                      <button disabled={busy} onClick={workflow.cancelRename} type="button">취소</button>
                    </form>
                  ) : (
                    <>
                      <span>
                        <strong>{tag.name}</strong>
                        <small>장소 {tag.placeCount}개</small>
                      </span>
                      <button disabled={busy} onClick={() => workflow.beginRename(tag.tagId)} type="button">
                        이름 변경
                      </button>
                      {deleting ? (
                        <>
                          <button
                            className={styles.danger}
                            disabled={busy}
                            onClick={() => void workflow.deleteTag(tag.tagId)}
                            type="button"
                          >삭제 확인</button>
                          <button disabled={busy} onClick={workflow.cancelDelete} type="button">취소</button>
                        </>
                      ) : (
                        <button
                          aria-label={`${tag.name} 태그 삭제`}
                          className={styles.danger}
                          disabled={busy}
                          onClick={() => workflow.armDelete(tag.tagId)}
                          type="button"
                        >삭제</button>
                      )}
                    </>
                  )}
                  {workflow.mutationKey === `rename:${tag.tagId}` && <small role="status">변경 중…</small>}
                  {workflow.mutationKey === `delete:${tag.tagId}` && <small role="status">삭제 중…</small>}
                </li>
              )
            })}
          </ul>
        )}

        {workflow.nextCursor !== undefined && (
          <button
            className={styles.more}
            disabled={busy || workflow.loadingMore}
            onClick={() => void workflow.loadMore()}
            type="button"
          >{workflow.loadingMore ? '불러오는 중…' : '태그 더 보기'}</button>
        )}
        {workflow.error !== undefined && (
          <div className={styles.error} role="alert">
            <span>{workflow.error}</span>
            <button disabled={busy} onClick={() => void workflow.retry()} type="button">다시 시도</button>
          </div>
        )}
      </div>
    </details>
  )
}

export function TagManagementPanel(properties: PanelProperties) {
  return <TagManagementView workflow={useTagManagementWorkflow(properties)} />
}
