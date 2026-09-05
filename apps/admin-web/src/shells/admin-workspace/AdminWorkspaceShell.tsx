'use client'

import { useState } from 'react'
import { AdminAccessGate, useAdminAccess } from '../../features/admin-access/public/index'
import { CatalogInspection } from '../../features/catalog-inspection/public/index'

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
      detail: '고정된 Backend 경계에서 권한과 공개 장소를 조회하고 token과 내부 주소는 노출하지 않습니다.',
      available: ready,
    },
    {
      title: '장소 데이터 조회',
      state: ready ? '읽기 전용 조회 가능' : '세션 확인 대기',
      detail: '내부 공개 카탈로그 검색과 상세 조회를 제공합니다. 검수·변경 기능은 활성화하지 않습니다.',
      available: ready,
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

export function AdminWorkspaceShell({ page = 'dashboard' }: Readonly<{ page?: 'dashboard' | 'catalog' }>) {
  const access = useAdminAccess()
  const [navigationOpen, setNavigationOpen] = useState(false)
  const ready = access.state.kind === 'ready'
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.mark}>곳</span>
          <div><strong>곳곳간</strong><small>Admin</small></div>
          <button className={styles.mobileNavigationToggle} aria-controls="admin-navigation"
            aria-expanded={navigationOpen} onClick={() => setNavigationOpen(!navigationOpen)} type="button">메뉴</button>
        </div>
        <nav className={`${styles.navigation} ${navigationOpen ? styles.navigationOpen : ''}`} id="admin-navigation" aria-label="관리자 메뉴">
          {adminNavigation.map((group) => (
            <section className={styles.navGroup} key={group.label}>
              <h2>{group.label}</h2>
              {group.items.map((item) => item.enabled ? (
                <a className={styles.activeNav} href={item.href} aria-current={item.href === (page === 'catalog' ? '/catalog' : '/') ? 'page' : undefined} key={item.label}>
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
              <h1>{page === 'catalog' ? '장소 데이터' : '운영 대시보드'}</h1>
              <span>실제 Backend Interface와 현재 운영자 권한으로 확인된 정보만 표시합니다.</span>
            </div>
          </div>
          {(page === 'dashboard' || !ready) && <AdminAccessGate state={access.state} retry={access.retry} />}
          {page === 'catalog' ? ready && <CatalogInspection /> : <CapabilityCards ready={ready} />}
        </main>
      </div>
    </div>
  )
}
