import type { AdminAccessState } from '@/domains/admin-access/admin-session'

import styles from './admin-access.module.css'

const stateCopy = {
  checking: {
    eyebrow: '접근 확인 중',
    title: '관리자 세션을 확인하고 있습니다',
    body: '브라우저 token을 노출하지 않고 서버에서 현재 회원 권한을 확인합니다.',
  },
  unauthenticated: {
    eyebrow: '로그인 필요',
    title: '관리자 계정으로 로그인해 주세요',
    body: '로그인 후에도 reviewer 이상의 Authority Role이 있어야 운영 화면에 접근할 수 있습니다.',
  },
  forbidden: {
    eyebrow: '접근 권한 없음',
    title: '이 계정은 관리자 앱을 사용할 수 없습니다',
    body: '일반 member 세션은 관리자 화면에서 거부됩니다. 권한 변경은 승인된 운영 절차를 이용해 주세요.',
  },
  unavailable: {
    eyebrow: '서비스 준비 필요',
    title: '관리자 인증 의존성을 확인할 수 없습니다',
    body: 'OIDC 또는 Backend Interface 설정과 readiness를 확인한 뒤 다시 시도해 주세요.',
  },
  ready: {
    eyebrow: '접근 확인 완료',
    title: '운영 workspace를 사용할 수 있습니다',
    body: '현재 제공되는 Capability만 활성화됩니다. 미구현 운영 영역은 명시적으로 비활성화되어 있습니다.',
  },
} as const

export function AdminAccessGate({ state, retry }: Readonly<{
  state: AdminAccessState
  retry: () => void
}>) {
  const copy = stateCopy[state.kind]
  return (
    <section className={styles.gate} aria-live="polite">
      <div className={`${styles.signal} ${styles[state.kind]}`} aria-hidden="true">
        {state.kind === 'checking' ? <span className={styles.spinner} /> : <span>{state.kind === 'ready' ? '✓' : '!'}</span>}
      </div>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <div className={styles.actions}>
          {state.kind === 'unauthenticated' ? (
            <a className={styles.primary} href="/api/auth/oidc/start">관리자 로그인</a>
          ) : null}
          {state.kind === 'unavailable' || state.kind === 'forbidden' ? (
            <button className={styles.secondary} type="button" onClick={retry}>다시 확인</button>
          ) : null}
          {state.kind === 'ready' ? (
            <span className={styles.role}>Authority Role · {state.session.authorityRole}</span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
