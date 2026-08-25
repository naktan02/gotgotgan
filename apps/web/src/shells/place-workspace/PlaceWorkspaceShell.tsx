'use client'

import { useState } from 'react'

import styles from './place-workspace-shell.module.css'

export function PlaceWorkspaceShell() {
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
        <span className={styles.stage}>구조 설계 중</span>
      </header>

      <aside
        className={navigationOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}
        id="place-navigation"
      >
        <nav aria-label="장소 서비스">
          <p className={styles.navLabel}>장소</p>
          <span aria-current="page" className={styles.activeItem}>작업 공간</span>
        </nav>
        <div className={styles.family}>
          <p className={styles.navLabel}>패밀리 서비스</p>
          <p className={styles.placeholder}>연결 계약 준비 중</p>
        </div>
      </aside>

      <main className={styles.main}>
        <section aria-labelledby="stage-one-title" className={styles.intro}>
          <p className={styles.eyebrow}>Stage 1</p>
          <h1 id="stage-one-title">장소를 다루기 위한 기반을 만들고 있습니다.</h1>
          <p>
            검색·지도·가져오기 화면보다 먼저 인증, 데이터 소유권, 수집 작업과 검증 경계를 고정합니다.
          </p>
          <dl className={styles.statusList}>
            <div><dt>웹 셸</dt><dd>구조 기준</dd></div>
            <div><dt>데이터</dt><dd>연결 전</dd></div>
            <div><dt>Provider</dt><dd>연결 전</dd></div>
          </dl>
        </section>
      </main>
    </div>
  )
}
