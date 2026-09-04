'use client'

import styles from '../personal-place-detail.module.css'
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
  if (workflow.personalRating === undefined) return null
  const busy = workflow.ratingSaving

  return (
    <section aria-labelledby="personal-rating-title" className={styles.preferences}>
      <div className={styles.preferenceHeading}>
        <div>
          <h3 id="personal-rating-title">내 평점</h3>
          <p>평점은 즐겨찾기 여부와 무관한 나만의 기록입니다.</p>
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

      <form
        className={styles.ratingEditor}
        onSubmit={(event) => {
          event.preventDefault()
          void workflow.saveRating()
        }}
      >
        <label htmlFor="personal-rating">0.1–5.0</label>
        <input
          disabled={busy}
          id="personal-rating"
          inputMode="decimal"
          max="5"
          min="0.1"
          onChange={(event) => workflow.setRatingDraft(event.target.value)}
          placeholder="평점"
          step="0.1"
          type="number"
          value={workflow.ratingDraft}
        />
        <button disabled={busy || !workflow.ratingValid} type="submit">평점 저장</button>
        <button
          disabled={busy || workflow.personalRating === null}
          onClick={() => void workflow.clearRating()}
          type="button"
        >
          평점 지우기
        </button>
      </form>
    </section>
  )
}
