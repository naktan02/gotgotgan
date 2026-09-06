'use client'

import { useState, type CSSProperties } from 'react'
import styles from './rating.module.css'
import type { PersonalPlaceDetailWorkflow } from '../personal-place-detail-workflow'

type RatingEditorProps = Readonly<{
  workflow: Pick<
    PersonalPlaceDetailWorkflow,
    | 'personalRating'
    | 'ratingSaving'
    | 'ratingError'
    | 'ratingDraft'
    | 'ratingValid'
    | 'canRetryRating'
    | 'setRatingDraft'
    | 'saveRating'
    | 'clearRating'
    | 'retryRating'
  >
}>

export function PersonalRatingEditor({ workflow }: RatingEditorProps) {
  const [editing, setEditing] = useState(false)
  if (workflow.personalRating === undefined) return null
  const busy = workflow.ratingSaving
  const value = Number(workflow.ratingDraft)

  return (
    <section aria-labelledby="personal-rating-title" className={styles.preferences}>
      <div className={styles.preferenceHeading}>
        <div>
          <h3 id="personal-rating-title">내 평점</h3>
          <p>나만 볼 수 있는 별점</p>
        </div>
        {busy && <span role="status">저장 중…</span>}
      </div>

      {workflow.ratingError !== undefined && (
        <div className={styles.preferenceError} role="alert">
          <span>{workflow.ratingError}</span>
          {workflow.canRetryRating && (
            <button onClick={() => void workflow.retryRating()} type="button">다시 시도</button>
          )}
        </div>
      )}

      <button className={styles.summary} aria-expanded={editing} onClick={() => setEditing(!editing)} type="button">
        <span aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} className={styles.summaryStar}
          style={{ '--fill': `${Math.min(1, Math.max(0, (workflow.personalRating ?? 0) - index)) * 100}%` } as CSSProperties}>★</span>)}</span>
        <strong>{workflow.personalRating === null ? '별점을 남겨 보세요' : workflow.personalRating.toFixed(1)}</strong><span>평가하기</span>
      </button>
      {editing && <form
        className={styles.ratingEditor}
        onSubmit={(event) => {
          event.preventDefault()
          void workflow.saveRating()
        }}
      >
        <fieldset className={styles.stars}><legend>별을 눌러 선택 · 0.5점 단위</legend>
          <div>{Array.from({ length: 10 }, (_, index) => {
            const score = (index + 1) / 2
            return <label key={score} className={styles.halfStar} data-side={index % 2 ? 'right' : 'left'} data-filled={value >= score}>
              <input type="radio" name="personal-rating" value={score} checked={value === score} disabled={busy}
                aria-label={`별점 ${score.toFixed(1)}점`} onChange={() => workflow.setRatingDraft(score.toFixed(1))} />
              <span aria-hidden="true">★</span>
            </label>
          })}</div>
          <output aria-live="polite">{workflow.ratingDraft ? `${value.toFixed(1)}점` : '미선택'}</output>
        </fieldset>
        <button disabled={busy || !workflow.ratingValid} type="submit">평점 저장</button>
        <button
          disabled={busy || workflow.personalRating === null}
          onClick={() => void workflow.clearRating()}
          type="button"
        >
          평점 지우기
        </button>
      </form>}
    </section>
  )
}
