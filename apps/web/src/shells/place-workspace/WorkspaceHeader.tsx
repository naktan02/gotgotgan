'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './place-workspace-shell.module.css'

export function WorkspaceHeader({ title, account, operationStatus, attentionCount }: Readonly<{
  title: string
  account?: Readonly<{ label: string; href?: string }>
  operationStatus: string
  attentionCount: number
}>) {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('place:theme') === 'dark'
      setDark(saved)
      document.documentElement.dataset.theme = saved ? 'dark' : 'light'
    } catch { /* A denied preference store leaves the default theme usable. */ }
  }, [])
  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    try { localStorage.setItem('place:theme', next ? 'dark' : 'light') } catch { /* Optional preference only. */ }
  }
  return <header className={styles.topbar}>
    <Link aria-label="곳곳간 홈" className={styles.wordmark} href="/">곳곳간</Link>
    <div className={styles.heading}>
      <h1><span>곳곳간 / </span>{title}</h1>
      <p>{account ? `${account.label}님, 반가워요.` : '좋은 곳을 모아, 더 가까운 일상으로.'}</p>
    </div>
    <div className={styles.topActions}>
      <Link aria-label={`현재 작업 상태: ${operationStatus}. 작업 내역 보기`} className={styles.modeButton} href="/settings?tab=history">{operationStatus}</Link>
      <Link aria-label={attentionCount > 0 ? `작업 알림 ${attentionCount}개. 작업 내역 보기` : '작업 내역 보기'} className={styles.iconButton} href="/settings?tab=history">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M6 17h12l-2-3V9a4 4 0 0 0-8 0v5zM10 20h4" /></svg>
        {attentionCount > 0 && <span className={styles.notificationBadge}>{Math.min(attentionCount, 99)}</span>}
      </Link>
      <button aria-label="어두운 화면" aria-pressed={dark} className={styles.iconButton} onClick={toggleTheme} type="button">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">{dark ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></> : <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>}</svg>
      </button>
      {account ? <>
        <Link aria-label={`${account.label} 프로필과 계정`} className={styles.profileLink} href={account.href ?? '/profile'}>
          <span aria-hidden="true" className={styles.avatar}>{account.label.slice(0, 1)}</span>
          <span className={styles.userCopy}><strong>{account.label}</strong><small>프로필 · 계정</small></span>
        </Link>
        <form action="/api/auth/logout" method="post"><button aria-label="로그아웃" className={styles.logout} type="submit"><span className={styles.logoutText}>로그아웃</span><span aria-hidden="true" className={styles.logoutIcon}>↪</span></button></form>
      </> : <a className={styles.loginLink} href="/api/auth/oidc/start">로그인</a>}
    </div>
  </header>
}
