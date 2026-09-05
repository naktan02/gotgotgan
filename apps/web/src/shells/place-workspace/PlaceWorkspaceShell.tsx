'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { publicProfileRecordSchema } from '@place/contracts/profiles'

import {
  createOperationPollController,
  loadOperationIndicator,
  type OperationIndicator,
} from '../../features/operation-history/public/index'
import type { FamilyNavigation } from '@/platform/family-navigation/family-navigation'

import { WorkspaceHeader } from './WorkspaceHeader'
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

export function PlaceWorkspaceShell({
  children,
  currentPage = 'home',
  familyNavigation,
  account,
}: Readonly<{
  children?: React.ReactNode
  currentPage?: NavigationPage
  familyNavigation: FamilyNavigation
  account?: Readonly<{ label: string; href?: string }>
}>) {
  const [familyOpen, setFamilyOpen] = useState(false)
  const [resolvedAccount, setResolvedAccount] = useState(account)
  const [operationIndicator, setOperationIndicator] = useState<OperationIndicator>()
  const familyRef = useRef<HTMLElement>(null)
  const familyButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!familyOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!familyRef.current?.contains(event.target as Node)) setFamilyOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFamilyOpen(false); familyButton.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [familyOpen])
  useEffect(() => {
    setResolvedAccount(account)
    if (account !== undefined) return
    const controller = new AbortController()
    void fetch('/api/profile', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted) return
      if (response.status === 404) {
        setResolvedAccount({ label: '내 계정', href: '/profile' })
      } else if (response.ok) {
        const profile = publicProfileRecordSchema.safeParse(await response.json())
        if (profile.success && !controller.signal.aborted) {
          setResolvedAccount({ label: profile.data.displayName, href: '/profile' })
        }
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [account])

  useEffect(() => {
    const polling = createOperationPollController<OperationIndicator>({
      read: (signal) => loadOperationIndicator(fetch, signal),
      isActive: (indicator) => indicator.activeCount > 0,
      onValue: (indicator) => setOperationIndicator(indicator),
      onTerminalError: () => setOperationIndicator(undefined),
    })
    const refresh = () => polling.trigger()
    const handleVisibility = () => document.visibilityState === 'hidden' ? polling.pause() : polling.resume()
    if (document.visibilityState === 'hidden') polling.pause()
    else polling.start()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('place:operation-projection-changed', refresh)
    return () => {
      polling.stop()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('place:operation-projection-changed', refresh)
    }
  }, [])

  const attentionCount = operationIndicator?.attentionCount ?? 0
  const operationStatus = (operationIndicator?.activeCount ?? 0) > 0
    ? `작업 ${operationIndicator?.activeCount ?? 0}개`
    : attentionCount > 0 ? `확인 ${attentionCount}개` : '작업 내역'

  return (
    <div className={styles.workspace}>
      <WorkspaceHeader
        title={placeNavigation.find((item) => item.id === currentPage)?.label ?? '장소 탐색'}
        account={resolvedAccount}
        operationStatus={operationStatus}
        attentionCount={attentionCount}
      />

      <aside className={styles.sidebar}>
        <nav aria-label="곳곳간 메뉴" className={styles.primaryNavigation}>
          <ul className={styles.placeList}>
            {placeNavigation.map((item) => (
              <li key={item.id}>
                <Link
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  className={currentPage === item.id ? styles.activeItem : styles.navItem}
                  href={item.href}
                >
                  <NavigationIcon id={item.id} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="패밀리 서비스" className={styles.family} ref={familyRef}>
          <button
            aria-controls="family-service-list"
            aria-expanded={familyOpen}
            aria-label={familyOpen ? '패밀리 서비스 접기' : '패밀리 서비스 펼치기'}
            className={styles.familyToggle}
            ref={familyButton}
            onClick={() => setFamilyOpen((current) => !current)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              {[4, 10, 16].flatMap((x) => [4, 10, 16].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="1" />))}
            </svg>
            <span>패밀리</span>
          </button>
          <div className={styles.familyPopover} hidden={!familyOpen} id="family-service-list">
            <strong>패밀리 서비스</strong>
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


      <main className={styles.main}>{children}</main>
    </div>
  )
}
