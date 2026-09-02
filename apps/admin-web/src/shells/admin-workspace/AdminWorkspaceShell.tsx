'use client'

import { AdminAccessGate, useAdminAccess } from '../../features/admin-access/public/index'

import { adminNavigation } from './navigation'
import styles from './admin-workspace.module.css'

const accessLabels = {
  checking: '확인 중',
  ready: '승인됨',
  unauthenticated: '로그인 필요',
  forbidden: '권한 없음',
  unavailable: '준비 필요',
} as const

function CapabilityCards({ ready }: Readonly<{ ready: boolean }>) {
  const capabilities = [
    {
      title: '관리자 접근 게이트',
      state: ready ? '현재 세션 확인됨' : '세션 확인 대기',
      detail: 'reviewer·administrator·owner만 허용하며 member는 BFF에서 거부합니다.',
      available: ready,
    },
    {
      title: 'Server-side Backend 중계',
      state: ready ? 'Backend 응답 확인됨' : '응답 확인 대기',
      detail: '고정된 Backend origin의 /v1/me만 호출하고 token과 내부 주소를 브라우저에 내보내지 않습니다.',
      available: ready,
    },
    {
      title: '운영 작업 화면',
      state: 'Backend Interface 미구현',
      detail: '장소·수집·사용자·시스템 작업은 owning Interface가 생긴 순서대로 활성화합니다.',
      available: false,
    },
  ] as const

  return (
    <section className={styles.capabilitySection} aria-labelledby="capability-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p>운영 범위</p>
          <h2 id="capability-heading">현재 사용할 수 있는 Capability</h2>
        </div>
        <span>실시간 세션 기준</span>
      </div>
      <div className={styles.capabilityGrid}>
        {capabilities.map((capability) => (
          <article className={styles.capabilityCard} key={capability.title}>
            <div className={styles.cardTopline}>
              <span className={capability.available ? styles.available : styles.pending} />
              <strong>{capability.state}</strong>
            </div>
            <h3>{capability.title}</h3>
            <p>{capability.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function AdminWorkspaceShell() {
  const access = useAdminAccess()
  const ready = access.state.kind === 'ready'
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.mark}>곳</span>
          <div><strong>곳곳간</strong><small>Admin</small></div>
        </div>
        <nav className={styles.navigation} aria-label="관리자 메뉴">
          {adminNavigation.map((group) => (
            <section className={styles.navGroup} key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => item.enabled ? (
                <a className={styles.activeNav} href="/" aria-current="page" key={item.label}>
                  <span className={styles.navDot} />{item.label}
                </a>
              ) : (
                <button
                  className={styles.disabledNav}
                  disabled
                  key={item.label}
                  title={item.detail}
                  type="button"
                >
                  <span>{item.label}</span><small>{item.detail}</small>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className={styles.sidebarBoundary}>
          <strong>별도 운영 앱</strong>
          <span>사용자 앱과 세션·프로세스를 분리합니다.</span>
        </div>
      </aside>

      <div className={styles.application}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <button type="button" aria-label="메뉴 접기" disabled>☰</button>
            <span>운영 상태</span>
          </div>
          <div className={styles.statuses}>
            <div><small>접근 상태</small><strong><i className={ready ? styles.ok : styles.wait} />{accessLabels[access.state.kind]}</strong></div>
            <div><small>Authority Role</small><strong>{ready ? access.state.session.authorityRole : '확인 전'}</strong></div>
            <div><small>알림</small><strong className={styles.muted}>Backend Interface 미구현</strong></div>
            {ready ? (
              <form action="/api/auth/logout" method="post">
                <button className={styles.logout} type="submit">로그아웃</button>
              </form>
            ) : null}
          </div>
        </header>

        <main className={styles.workspace}>
          <div className={styles.pageHeading}>
            <div>
              <p>Operations control plane</p>
              <h1>운영 대시보드</h1>
              <span>실제 Backend Interface와 현재 운영자 권한으로 확인된 정보만 표시합니다.</span>
            </div>
          </div>
          <AdminAccessGate state={access.state} retry={access.retry} />
          <CapabilityCards ready={ready} />
        </main>
      </div>
    </div>
  )
}
