'use client'

import { useState } from 'react'
import Link from 'next/link'

import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'

import styles from './place-workspace-shell.module.css'

const placeNavigation = [
  { id: 'home', label: '작업 공간', href: '/' },
  { id: 'library', label: '내 장소', href: '/library' },
  { id: 'profile', label: '공개 프로필', href: '/profile' },
  { id: 'search', label: '장소 찾기', href: '/search' },
  { id: 'imports', label: '가져오기', href: '/imports' },
] as const

export function PlaceWorkspaceShell({
  children,
  currentPage = 'home',
  familyNavigation,
  stageLabel = '로컬 검색',
}: Readonly<{
  children?: React.ReactNode
  currentPage?: (typeof placeNavigation)[number]['id']
  familyNavigation: FamilyNavigation
  stageLabel?: string
}>) {
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
        <span className={styles.wordmark}>곳곳간</span>
        <span className={styles.stage}>{stageLabel}</span>
      </header>

      <aside
        className={navigationOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}
        id="place-navigation"
      >
        <nav aria-label="장소 서비스">
          <p className={styles.navLabel}>장소</p>
          <ul className={styles.placeList}>
            {placeNavigation.map((item) => (
              <li key={item.id}>
                <Link
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  className={currentPage === item.id ? styles.activeItem : styles.navItem}
                  href={item.href}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
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
        {children ?? (
          <section aria-labelledby="place-home-title" className={styles.intro}>
            <p className={styles.eyebrow}>곳곳간</p>
            <h1 id="place-home-title">저장한 장소와 새로 찾을 장소를 한 흐름에서 관리합니다.</h1>
            <p>로컬 검색과 개인 기록을 먼저 연결하고, Provider 검색과 가져오기는 검증 가능한 소스로 순차 확장합니다.</p>
            <dl className={styles.statusList}>
              <div><dt>권한</dt><dd>곳곳간 소유 정책</dd></div>
              <div><dt>검색</dt><dd>로컬 색인</dd></div>
              <div><dt>Provider</dt><dd>연결 전</dd></div>
            </dl>
          </section>
        )}
      </main>
    </div>
  )
}
