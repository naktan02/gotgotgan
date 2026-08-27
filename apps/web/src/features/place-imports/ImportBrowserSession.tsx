import styles from './connected-place-imports.module.css'
import type { ImportBrowserSessionState } from './connected-place-imports-workflow'

export function ImportBrowserSession({
  state,
}: Readonly<{ state: ImportBrowserSessionState }>) {
  if (state === 'checking') return null
  if (state === 'anonymous') {
    return (
      <section aria-labelledby="place-login-title" className={styles.sessionBoundary}>
        <div>
          <p className={styles.eyebrow}>Place 계정</p>
          <h2 id="place-login-title">저장 목록을 가져오려면 로그인해 주세요</h2>
          <p>통합 계정 로그인 후 Place 이용 동의와 개인 멤버십 연결을 이어서 진행합니다.</p>
        </div>
        <a className={styles.primaryLink} href="/api/auth/oidc/start">
          통합 계정으로 로그인
        </a>
      </section>
    )
  }
  return (
    <form action="/api/auth/logout" className={styles.logout} method="post">
      <button type="submit">로그아웃</button>
    </form>
  )
}
