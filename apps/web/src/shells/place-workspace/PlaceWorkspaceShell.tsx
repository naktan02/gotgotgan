'use client'

import { useState } from 'react'

import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'

import styles from './place-workspace-shell.module.css'

export function PlaceWorkspaceShell({ familyNavigation }: Readonly<{ familyNavigation: FamilyNavigation }>) {
  const [navigationOpen, setNavigationOpen] = useState(false)

  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <button
          aria-controls="place-navigation"
          aria-expanded={navigationOpen}
          aria-label="메뉴 열기"
          className={styles.menuButton}
          onClick={() => setNavigationOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true" className={styles.menuGlyph} />
        </button>
        <span className={styles.wordmark}>Place</span>
        <span className={styles.stage}>기반 구축 중</span>
      </header>

      <aside
        className={navigationOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}
        id="place-navigation"
      >
        <nav aria-label="장소 서비스">
          <p className={styles.navLabel}>장소</p>
          <span aria-current="page" className={styles.activeItem}>작업 공간</span>
        </nav>
        <nav aria-label="패밀리 서비스" className={styles.family}>
          <p className={styles.navLabel}>패밀리 서비스</p>
          {familyNavigation.deliveryState === 'active' && familyNavigation.items.length > 0 ? (
            <ul className={styles.familyList}>
              {familyNavigation.items.map((item) => (
                <li key={item.serviceId}>
                  <a className={styles.familyLink} href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.placeholder}>연결 준비 중</p>
          )}
        </nav>
      </aside>

      <main className={styles.main}>
        <section aria-labelledby="stage-two-title" className={styles.intro}>
          <p className={styles.eyebrow}>Stage 2</p>
          <h1 id="stage-two-title">장소를 모으기 위한 안전한 기반을 만들고 있습니다.</h1>
          <p>
            검색과 가져오기 화면보다 먼저 인증 증거, Place 내부 권한, 패밀리 서비스 연결 경계를 고정합니다.
          </p>
          <dl className={styles.statusList}>
            <div><dt>권한</dt><dd>정책 구현</dd></div>
            <div><dt>데이터</dt><dd>연결 전</dd></div>
            <div><dt>Provider</dt><dd>연결 전</dd></div>
          </dl>
        </section>
      </main>
    </div>
  )
}
