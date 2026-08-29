'use client'

import { useState } from 'react'

import {
  type PublicProfileAppealReason,
  usePublicProfileModeration,
} from './public-profile-moderation'
import styles from './public-profile-moderation.module.css'

const appealReasons: readonly Readonly<{ value: PublicProfileAppealReason; label: string }>[] = [
  { value: 'mistaken-identity', label: '다른 프로필로 잘못 판단된 것 같습니다' },
  { value: 'issue-corrected', label: '문제가 된 부분을 수정했습니다' },
  { value: 'decision-context', label: '판정 맥락을 다시 확인해 주세요' },
]

const kindLabels = {
  withheld: '공개 프로필이 비공개 처리되었습니다',
  restored: '공개 프로필이 다시 공개될 수 있습니다',
  'appeal-rejected': '이의 제기가 받아들여지지 않았습니다',
} as const

const reasonLabels = {
  impersonation: '다른 사람이나 단체로 오해될 수 있음',
  harassment: '괴롭힘 또는 위협 우려',
  privacy: '개인정보 노출 우려',
  spam: '스팸 또는 반복적인 홍보',
  'unsafe-content': '안전하지 않은 콘텐츠',
  'insufficient-evidence': '제한을 유지할 근거가 충분하지 않음',
  'appeal-accepted': '이의 제기가 받아들여짐',
  'decision-upheld': '기존 판정이 유지됨',
  'insufficient-remediation': '문제가 충분히 해소되지 않음',
} as const

const appealStatusLabels = {
  pending: '검토 중',
  accepted: '받아들여짐',
  rejected: '기각됨',
  superseded: '프로필 상태 변경으로 종료됨',
} as const

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function PublicProfileModerationInbox() {
  const workflow = usePublicProfileModeration()
  const [selectedReasons, setSelectedReasons] = useState<Readonly<Record<string, PublicProfileAppealReason>>>({})

  if (workflow.loadState === 'authentication-required') return null
  if (workflow.loadState === 'loading') {
    return <section aria-label="프로필 검토 알림" className={styles.inbox}>
      <p role="status">검토 알림을 불러오는 중…</p>
    </section>
  }
  if (workflow.loadState === 'unavailable') {
    return <section aria-labelledby="profile-moderation-title" className={styles.inbox}>
      <h2 id="profile-moderation-title">프로필 검토 알림</h2>
      <p role="alert">검토 알림을 지금 불러올 수 없습니다.</p>
      <button onClick={() => void workflow.reload()} type="button">다시 시도</button>
    </section>
  }

  return <section aria-labelledby="profile-moderation-title" className={styles.inbox}>
    <header>
      <div>
        <p>Profile safety</p>
        <h2 id="profile-moderation-title">프로필 검토 알림</h2>
      </div>
      <span>공개 상태에 영향을 준 판정과 이의 제기 결과를 이 화면에서 확인합니다.</span>
    </header>

    {workflow.notices.length === 0
      ? <p className={styles.empty}>새 검토 알림이 없습니다.</p>
      : <ol className={styles.noticeList}>
          {workflow.notices.map((notice, index) => {
            const selectedReason = selectedReasons[notice.noticeId]
            const canAppeal = index === 0 && notice.kind === 'withheld' && notice.appeal === null
            return <li key={notice.noticeId}>
              <article aria-labelledby={`notice-${notice.noticeId}`} className={styles.notice}>
                <div className={styles.noticeHeading}>
                  <div>
                    {notice.acknowledgedAt === null && <span className={styles.unread}>새 알림</span>}
                    <h3 id={`notice-${notice.noticeId}`}>{kindLabels[notice.kind]}</h3>
                  </div>
                  <time dateTime={notice.createdAt}>{dateFormatter.format(new Date(notice.createdAt))}</time>
                </div>
                <p>{reasonLabels[notice.reason]}</p>
                <small>@{notice.handle}</small>

                {notice.appeal !== null && <div className={styles.appealStatus} role="status">
                  <strong>이의 제기: {appealStatusLabels[notice.appeal.status]}</strong>
                  <span>{appealReasons.find((reason) => reason.value === notice.appeal?.reason)?.label}</span>
                </div>}

                {canAppeal && <form className={styles.appealForm} onSubmit={(event) => {
                  event.preventDefault()
                  if (selectedReason !== undefined) void workflow.appeal(notice.noticeId, selectedReason)
                }}>
                  <label htmlFor={`appeal-reason-${notice.noticeId}`}>다시 검토할 사유</label>
                  <select
                    id={`appeal-reason-${notice.noticeId}`}
                    onChange={(event) => setSelectedReasons((current) => ({
                      ...current,
                      [notice.noticeId]: event.target.value as PublicProfileAppealReason,
                    }))}
                    required
                    value={selectedReason ?? ''}
                  >
                    <option disabled value="">사유를 선택하세요</option>
                    {appealReasons.map((reason) => <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>)}
                  </select>
                  <button
                    disabled={selectedReason === undefined || workflow.submittingNoticeId === notice.noticeId}
                    type="submit"
                  >
                    {workflow.submittingNoticeId === notice.noticeId ? '제출 중…' : '이의 제기 제출'}
                  </button>
                  <small>자유 서술이나 첨부 없이 선택한 사유만 전달됩니다.</small>
                </form>}

                {notice.acknowledgedAt === null
                  ? <button
                      className={styles.acknowledge}
                      disabled={workflow.acknowledgingNoticeId === notice.noticeId}
                      onClick={() => void workflow.acknowledge(notice.noticeId)}
                      type="button"
                    >
                      {workflow.acknowledgingNoticeId === notice.noticeId ? '확인 중…' : '알림 확인'}
                    </button>
                  : <span className={styles.acknowledged}>확인함</span>}
              </article>
            </li>
          })}
        </ol>}

    {workflow.error !== undefined && <p className={styles.error} role="alert">{workflow.error}</p>}
    {workflow.nextCursor !== undefined && <button
      className={styles.loadMore}
      disabled={workflow.loadingMore}
      onClick={() => void workflow.loadMore()}
      type="button"
    >
      {workflow.loadingMore ? '불러오는 중…' : '이전 알림 더 보기'}
    </button>}
    <footer>이 조회함은 이메일·푸시 전송을 의미하지 않으며, 운영 검토 결과는 여기에 기록됩니다.</footer>
  </section>
}
