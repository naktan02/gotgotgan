'use client'

import type { PersonalLibraryVisits as PersonalLibraryVisitsWorkflow } from './personal-library-visit-workflow'
import styles from './personal-library.module.css'

const visitDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatVisitDate(value: string): string {
  return visitDateFormatter.format(new Date(value))
}

export function PersonalLibraryVisits({
  visits,
}: Readonly<{ visits: PersonalLibraryVisitsWorkflow }>) {
  const summary = visits.summary
  const latest = summary?.visited ? formatVisitDate(summary.lastVisitedAt) : undefined

  return (
    <section aria-labelledby="personal-visits-title" className={styles.visits}>
      <div className={styles.visitHeading}>
        <div>
          <h3 id="personal-visits-title">방문 기록</h3>
          <p>{summary?.visited
            ? `총 ${summary.count}회 · 최근 ${latest}`
            : '아직 기록한 방문이 없습니다.'}</p>
        </div>
      </div>

      <form
        className={styles.visitForm}
        onSubmit={(event) => {
          event.preventDefault()
          void visits.record()
        }}
      >
        <label htmlFor="visited-at">방문한 시각</label>
        <div>
          <input
            disabled={visits.recording}
            id="visited-at"
            max={visits.maxVisitedAtLocal || undefined}
            onChange={(event) => visits.setVisitedAtLocal(event.target.value)}
            step="60"
            type="datetime-local"
            value={visits.visitedAtLocal}
          />
          <button disabled={visits.recording || !visits.recordValid} type="submit">
            {visits.recording ? '기록 중…' : '방문 추가'}
          </button>
        </div>
        <small>방문은 반복해서 추가할 수 있으며 기록 후 수정하거나 삭제하지 않습니다.</small>
      </form>

      {visits.error !== undefined && (
        <div className={styles.visitError} role="alert">
          <span>{visits.error}</span>
          {visits.canRetryRecord ? (
            <button onClick={() => void visits.retryRecord()} type="button">같은 기록 다시 확인</button>
          ) : visits.canRetryHistory ? (
            <button onClick={() => void visits.retryHistory()} type="button">이력 다시 불러오기</button>
          ) : null}
        </div>
      )}
      {visits.notice !== undefined && <p className={styles.visitNotice} role="status">{visits.notice}</p>}

      <div className={styles.visitHistory}>
        <strong>최근 방문</strong>
        {visits.loading ? (
          <p>방문 이력을 불러오는 중…</p>
        ) : visits.items.length === 0 && visits.error === undefined ? (
          <p>표시할 방문 기록이 없습니다.</p>
        ) : (
          <ol>
            {visits.items.map((item) => (
              <li key={item.visitId}>
                <span>{formatVisitDate(item.visitedAt)}</span>
                <small>기록 {formatVisitDate(item.recordedAt)}</small>
              </li>
            ))}
          </ol>
        )}
        {visits.nextCursor !== undefined && (
          <button
            disabled={visits.loadingMore}
            onClick={() => void visits.loadMore()}
            type="button"
          >
            {visits.loadingMore ? '불러오는 중…' : '이전 방문 더 보기'}
          </button>
        )}
      </div>
    </section>
  )
}
