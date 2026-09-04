'use client'

import type { PersonalNotesWorkflow } from './note-workflow'
import styles from '../personal-place-detail.module.css'

const noteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function PersonalNotes({
  notes,
}: Readonly<{ notes: PersonalNotesWorkflow }>) {
  return (
    <section aria-labelledby="personal-notes-title" className={styles.notes}>
      <div className={styles.noteHeading}>
        <div>
          <h3 id="personal-notes-title">내 메모</h3>
          <p>이 장소에만 연결된 비공개 메모입니다.</p>
        </div>
        <button disabled={notes.dirty || notes.saving} onClick={notes.startNew} type="button">
          새 메모
        </button>
      </div>

      <form
        className={styles.noteForm}
        onSubmit={(event) => {
          event.preventDefault()
          void notes.save()
        }}
      >
        <label htmlFor="personal-note-body">
          {notes.selectedDocumentId === undefined ? '새 비공개 메모' : '메모 편집'}
        </label>
        {notes.selectedCreatedAt !== undefined && (
          <p className={styles.noteDates}>
            작성 {noteDateFormatter.format(new Date(notes.selectedCreatedAt))}
            {notes.selectedUpdatedAt !== notes.selectedCreatedAt && notes.selectedUpdatedAt !== undefined
              ? ` · 수정 ${noteDateFormatter.format(new Date(notes.selectedUpdatedAt))}`
              : ''}
          </p>
        )}
        <textarea
          disabled={notes.detailLoading || notes.saving}
          id="personal-note-body"
          maxLength={2_000}
          onChange={(event) => notes.setDraft(event.target.value)}
          placeholder="이 장소에서 기억하고 싶은 내용을 적어보세요."
          rows={5}
          value={notes.draft}
        />
        <div className={styles.noteActions}>
          <span>{notes.dirty ? '저장되지 않은 변경 · ' : ''}{notes.draft.length}/2000</span>
          {notes.dirty && (
            <button disabled={notes.saving} onClick={notes.discardChanges} type="button">변경 취소</button>
          )}
          <button
            disabled={notes.saving || !notes.dirty || !notes.bodyValid || notes.versionConflict}
            type="submit"
          >
            {notes.saving ? '저장 중…' : '메모 저장'}
          </button>
        </div>
      </form>

      {notes.error !== undefined && (
        <div className={styles.noteError} role="alert">
          <span>{notes.error}</span>
          {notes.canRetryCommand ? (
            <button onClick={() => void notes.retryCommand()} type="button">같은 저장 다시 확인</button>
          ) : notes.canRetryList ? (
            <button onClick={() => void notes.retryList()} type="button">목록 다시 불러오기</button>
          ) : notes.versionConflict ? (
            <button onClick={() => void notes.reloadConflict()} type="button">최신 내용 불러오기</button>
          ) : null}
        </div>
      )}
      {notes.notice !== undefined && <p className={styles.noteNotice} role="status">{notes.notice}</p>}

      <div className={styles.noteList}>
        <strong>이 장소의 메모</strong>
        {notes.loading ? (
          <p>메모 목록을 불러오는 중…</p>
        ) : notes.items.length === 0 && notes.error === undefined ? (
          <p>아직 작성한 메모가 없습니다.</p>
        ) : (
          <ol>
            {notes.items.map((item) => (
              <li key={item.documentId}>
                <button
                  aria-pressed={notes.selectedDocumentId === item.documentId}
                  disabled={notes.dirty && notes.selectedDocumentId !== item.documentId}
                  onClick={() => void notes.edit(item.documentId)}
                  type="button"
                >
                  <span>{item.bodyPreview}{item.bodyTruncated ? '…' : ''}</span>
                  <small>
                    비공개 · 작성 {noteDateFormatter.format(new Date(item.createdAt))}
                    {item.updatedAt !== item.createdAt ? ' · 수정됨' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        )}
        {notes.nextCursor !== undefined && (
          <button disabled={notes.loadingMore} onClick={() => void notes.loadMore()} type="button">
            {notes.loadingMore ? '불러오는 중…' : '메모 더 보기'}
          </button>
        )}
      </div>
    </section>
  )
}
