'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './place-filing.module.css'
import type { PlaceFilingWorkflow } from './place-filing-workflow'

export function PlaceFilingEditor({ workflow }: Readonly<{ workflow: PlaceFilingWorkflow }>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus() }
  }, [open])
  const included = workflow.filing?.collections.filter((collection) => collection.included) ?? []
  const total = workflow.filing?.overlay.collectionCount ?? 0
  return (
    <section aria-labelledby="place-filing-title" className={styles.filingEditor}>
      <button className={styles.summary} type="button" ref={trigger} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span><strong id="place-filing-title">{total ? `${total}개 목록에 저장됨` : '내 목록에 저장'}</strong>
          <small>{included.slice(0, 2).map((item) => item.name).join(' · ') || '즐겨찾기 카테고리를 선택하세요'}{total > included.slice(0, 2).length ? ` 외 ${total - included.slice(0, 2).length}개` : ''}</small>
          {workflow.dirtyCount > 0 && <small>저장되지 않은 변경 {workflow.dirtyCount}개</small>}</span><span>변경 ›</span>
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="filing-dialog-title" onCancel={(event) => { event.preventDefault(); setOpen(false) }}>
      <div className={styles.filingHeading}>
        <div>
          <h3 id="filing-dialog-title">내 카테고리</h3>
          <p>한 장소를 여러 카테고리에 함께 담을 수 있습니다.</p>
        </div>
        {workflow.loading && <span role="status">불러오는 중…</span>}
        <button type="button" aria-label="카테고리 선택 닫기" onClick={() => setOpen(false)}>×</button>
      </div>
      <label className={styles.search}>불러온 목록에서 찾기<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="목록 이름 검색" /></label>

      {workflow.message !== undefined && (
        <div className={styles[`filing_${workflow.message.tone}`]} role={workflow.message.tone === 'error' ? 'alert' : 'status'}>
          <span>{workflow.message.text}</span>
          {workflow.message.tone === 'error' && (
            <button onClick={() => void (workflow.retrySave() ?? workflow.retryLoad())} type="button">
              다시 시도
            </button>
          )}
        </div>
      )}

      {!workflow.loading && workflow.filing?.collections.length === 0 && (
        <p className={styles.filingEmpty}><a href="/library">내 곳곳간</a>에서 목록을 먼저 만들어 주세요.</p>
      )}

      <div aria-busy={workflow.loading || workflow.saving} className={styles.filingChoices}>
        {workflow.filing?.collections.filter((collection) => collection.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((collection) => (
          <label key={collection.collectionId}>
            <input
              checked={workflow.desired[collection.collectionId] ?? collection.included}
              disabled={workflow.saving}
              onChange={() => workflow.toggle(collection.collectionId)}
              type="checkbox"
            />
            <span>{collection.name}</span>
            <small>{(workflow.desired[collection.collectionId] ?? collection.included) ? '포함' : '미포함'}</small>
          </label>
        ))}
      </div>
      {query && !workflow.filing?.collections.some((collection) => collection.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p className={styles.filingEmpty}>불러온 목록에서 찾지 못했습니다. 다음 목록도 확인해 보세요.</p>}

      {workflow.filing?.nextCursor !== undefined && (
        <button
          className={styles.secondaryButton}
          disabled={workflow.loadingMore}
          onClick={() => void workflow.loadMore()}
          type="button"
        >{workflow.loadingMore ? '불러오는 중…' : '카테고리 더 보기'}</button>
      )}

      {(workflow.filing?.collections.length ?? 0) > 0 && (
        <div className={styles.filingActions}>
          <span aria-live="polite">{workflow.dirtyCount > 0 ? `${workflow.dirtyCount}개 변경` : '변경 없음'}</span>
          <button
            disabled={workflow.saving || workflow.dirtyCount === 0}
            onClick={() => void workflow.save()}
            type="button"
          >{workflow.saving ? '저장 중…' : '변경 저장'}</button>
        </div>
      )}
      </dialog>
    </section>
  )
}
