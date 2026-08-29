'use client'

import styles from './personal-place-detail.module.css'
import type { PersonalPlaceDetailWorkflow } from './personal-place-detail-workflow'

type PreferenceEditorProps = Readonly<{
  workflow: Pick<
    PersonalPlaceDetailWorkflow,
    | 'preferenceState'
    | 'preferenceMutationKey'
    | 'preferenceError'
    | 'ratingDraft'
    | 'ratingValid'
    | 'canRetryPreference'
    | 'setRatingDraft'
    | 'setSaved'
    | 'setWanted'
    | 'saveRating'
    | 'clearRating'
    | 'retryPreference'
  >
}>

export function PersonalLibraryPreferenceEditor({ workflow }: PreferenceEditorProps) {
  const state = workflow.preferenceState
  if (state === undefined) return null
  const busy = workflow.preferenceMutationKey !== undefined

  return (
    <section aria-labelledby="personal-preferences-title" className={styles.preferences}>
      <div className={styles.preferenceHeading}>
        <div>
          <h3 id="personal-preferences-title">내 상태</h3>
          <p>다른 기기에서 바뀐 값은 덮어쓰지 않고 먼저 최신 상태를 불러옵니다.</p>
        </div>
        {busy && <span>저장 중…</span>}
      </div>

      {workflow.preferenceError !== undefined && (
        <div className={styles.preferenceError} role="alert">
          <span>{workflow.preferenceError}</span>
          {workflow.canRetryPreference && (
            <button onClick={() => void workflow.retryPreference()} type="button">다시 시도</button>
          )}
        </div>
      )}

      <div className={styles.preferenceToggles}>
        <button
          aria-pressed={state.saved}
          disabled={busy}
          onClick={() => void workflow.setSaved(!state.saved)}
          type="button"
        >
          <span>저장</span>
          <small>{workflow.preferenceMutationKey === 'saved' ? '저장 중…' : state.saved ? '저장됨' : '저장 안 함'}</small>
        </button>
        <button
          aria-pressed={state.wanted}
          disabled={busy}
          onClick={() => void workflow.setWanted(!state.wanted)}
          type="button"
        >
          <span>가고 싶음</span>
          <small>{workflow.preferenceMutationKey === 'wanted' ? '저장 중…' : state.wanted ? '표시됨' : '표시 안 함'}</small>
        </button>
      </div>

      <form
        className={styles.ratingEditor}
        onSubmit={(event) => {
          event.preventDefault()
          void workflow.saveRating()
        }}
      >
        <label htmlFor="personal-rating">내 평점</label>
        <input
          disabled={busy}
          id="personal-rating"
          inputMode="decimal"
          max="5"
          min="0.1"
          onChange={(event) => workflow.setRatingDraft(event.target.value)}
          placeholder="0.1–5.0"
          step="0.1"
          type="number"
          value={workflow.ratingDraft}
        />
        <button disabled={busy || !workflow.ratingValid} type="submit">평점 저장</button>
        <button
          disabled={busy || state.personalRating === null}
          onClick={() => void workflow.clearRating()}
          type="button"
        >
          평점 지우기
        </button>
      </form>
    </section>
  )
}
