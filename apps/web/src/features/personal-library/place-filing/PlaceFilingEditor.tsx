'use client'

import styles from './place-filing.module.css'
import type { PlaceFilingWorkflow } from './place-filing-workflow'
import { usePlaceFilingWorkflow } from './place-filing-workflow'

export function PlaceFilingEditor({ workflow }: Readonly<{ workflow: PlaceFilingWorkflow }>) {
  return (
    <section aria-labelledby="place-filing-title" className={styles.filingEditor}>
      <div className={styles.filingHeading}>
        <div>
          <h3 id="place-filing-title">내 카테고리</h3>
          <p>한 장소를 여러 카테고리에 함께 담을 수 있습니다.</p>
        </div>
        {workflow.loading && <span role="status">불러오는 중…</span>}
      </div>

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
        <p className={styles.filingEmpty}>먼저 왼쪽에서 카테고리를 만들어 주세요.</p>
      )}

      <div aria-busy={workflow.loading || workflow.saving} className={styles.filingChoices}>
        {workflow.filing?.collections.map((collection) => (
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
    </section>
  )
}

export function PlaceFilingControl({
  onAccessFailure,
  onApplied,
  placeId,
}: Readonly<{
  onAccessFailure: (status: number) => void
  onApplied: () => Promise<unknown>
  placeId: string | undefined
}>) {
  return (
    <PlaceFilingEditor
      workflow={usePlaceFilingWorkflow(placeId, onApplied, onAccessFailure)}
    />
  )
}
