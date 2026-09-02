'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'

import styles from './place-workspace-shell.module.css'

const placeNavigation = [
  { id: 'home', label: '홈', href: '/' },
  { id: 'library', label: '내 곳곳간', href: '/library' },
  { id: 'explore', label: '둘러보기', href: '/browse' },
  { id: 'settings', label: '설정', href: '/settings' },
] as const

type NavigationPage = (typeof placeNavigation)[number]['id'] | 'legacy'

function NavigationIcon({ id }: Readonly<{ id: NavigationPage }>) {
  const path = id === 'home'
    ? <><path d="M3 10.5 10 4l7 6.5" /><path d="M5.5 9.5V17h9V9.5" /></>
    : id === 'library'
      ? <><path d="M5 3.5h10v14l-5-3-5 3z" /><path d="M8 7h4" /></>
      : id === 'explore'
        ? <><circle cx="10" cy="10" r="7" /><path d="m12.5 7.5-1.6 3.4-3.4 1.6 1.6-3.4z" /></>
        : <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>
  return (
    <svg aria-hidden="true" className={styles.navIcon} fill="none" viewBox="0 0 20 20">
      {path}
    </svg>
  )
}

function DefaultSearch() {
  return (
    <form action="/" className={styles.defaultSearch} role="search">
      <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
        <circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" />
      </svg>
      <input aria-label="곳곳간 카탈로그 검색" name="q" placeholder="장소, 지역, 분류로 검색" />
    </form>
  )
}

export function PlaceWorkspaceShell({
  children,
  currentPage = 'home',
  familyNavigation,
  topbarSearch,
  account,
}: Readonly<{
  children?: React.ReactNode
  currentPage?: NavigationPage
  familyNavigation: FamilyNavigation
  topbarSearch?: React.ReactNode
  account?: Readonly<{ label: string; href?: string }>
}>) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [familyOpen, setFamilyOpen] = useState(true)
  const [resolvedAccount, setResolvedAccount] = useState(account)
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)

  const closeNavigation = (restoreFocus = false) => {
    setNavigationOpen(false)
    if (restoreFocus) window.setTimeout(() => menuButton.current?.focus())
  }

  useEffect(() => {
    if (!navigationOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNavigation(true)
      if (event.key === 'Tab' && window.matchMedia('(max-width: 720px)').matches) {
        const focusable = [...(sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        ) ?? [])].filter((item) => !item.hasAttribute('hidden'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first === undefined || last === undefined) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    if (window.matchMedia('(max-width: 720px)').matches) {
      sidebar.current?.querySelector<HTMLElement>('a, button')?.focus()
    }
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigationOpen])

  useEffect(() => {
    setResolvedAccount(account)
    if (account !== undefined) return
    const controller = new AbortController()
    void fetch('/api/profile', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then((response) => {
      if ([200, 403, 404].includes(response.status)) {
        setResolvedAccount({ label: '내 계정', href: '/profile' })
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [account])

  return (
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <button
          aria-controls="place-navigation"
          aria-expanded={navigationOpen}
          aria-label={navigationOpen ? '메뉴 닫기' : '메뉴 열기'}
          className={styles.menuButton}
          ref={menuButton}
          onClick={() => setNavigationOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true" className={styles.menuGlyph} />
        </button>
        <Link aria-label="곳곳간 홈" className={styles.wordmark} href="/">곳곳간</Link>
        <div className={styles.searchSlot}>{topbarSearch ?? <DefaultSearch />}</div>
        <div className={styles.topActions}>
          <div aria-label="작업 상태: 카탈로그 탐색" className={styles.modeButton} role="status">
            <span aria-hidden="true" className={styles.modeDot} />
            <span>카탈로그</span>
          </div>
          <button aria-label="알림: 준비 중" className={styles.iconButton} disabled title="알림 Interface 준비 중" type="button">
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <path d="M4.5 14.5h11l-1.5-2V8a4 4 0 0 0-8 0v4.5z" /><path d="M8.5 17h3" />
            </svg>
          </button>
          {resolvedAccount?.href !== undefined ? (
            <Link aria-label={`${resolvedAccount.label} 프로필과 계정`} className={styles.profileLink} href={resolvedAccount.href}>
              <span aria-hidden="true">{resolvedAccount.label.slice(0, 1)}</span><small>{resolvedAccount.label}</small>
            </Link>
          ) : (
            <a className={styles.loginLink} href="/api/auth/oidc/start">로그인</a>
          )}
        </div>
      </header>

      <aside
        className={navigationOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}
        id="place-navigation"
        ref={sidebar}
        role={navigationOpen ? 'dialog' : undefined}
        aria-modal={navigationOpen ? true : undefined}
      >
        <nav aria-label="곳곳간 메뉴" className={styles.primaryNavigation}>
          <ul className={styles.placeList}>
            {placeNavigation.map((item) => (
              <li key={item.id}>
                <Link
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  className={currentPage === item.id ? styles.activeItem : styles.navItem}
                  href={item.href}
                  onClick={() => closeNavigation()}
                >
                  <NavigationIcon id={item.id} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="패밀리 서비스" className={styles.family}>
          <button
            aria-controls="family-service-list"
            aria-expanded={familyOpen}
            aria-label={familyOpen ? '패밀리 서비스 접기' : '패밀리 서비스 펼치기'}
            className={styles.familyToggle}
            onClick={() => setFamilyOpen((current) => !current)}
            type="button"
          >
            <span>패밀리 서비스</span>
            <svg aria-hidden="true" className={familyOpen ? styles.chevronOpen : undefined} fill="none" viewBox="0 0 20 20">
              <path d="m6.5 8 3.5 3.5L13.5 8" />
            </svg>
          </button>
          <div hidden={!familyOpen} id="family-service-list">
            {familyNavigation.deliveryState === 'active' && familyNavigation.items.length > 0 ? (
              <ul className={styles.familyList}>
                {familyNavigation.items.map((item) => (
                  <li key={item.serviceId}>
                    <a className={styles.familyLink} href={item.href}>
                      <span aria-hidden="true" className={styles.familyMark} />
                      <span>{item.label}</span>
                      <span aria-hidden="true" className={styles.externalMark}>↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.placeholder}>연결 준비 중</p>
            )}
          </div>
        </nav>
      </aside>

      {navigationOpen && (
        <button
          aria-label="메뉴 닫기"
          className={styles.scrim}
          onClick={() => closeNavigation(true)}
          type="button"
        />
      )}

      <main className={styles.main}>{children}</main>
    </div>
  )
}
