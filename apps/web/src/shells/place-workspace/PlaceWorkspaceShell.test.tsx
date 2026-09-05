import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlaceWorkspaceShell } from './PlaceWorkspaceShell'

const familyNavigation = { contract: 'family-navigation.v1', deliveryState: 'active', items: [{
  serviceId: 'trip', label: '여행메이트', href: 'https://family.example/trip',
}] } as const

describe('PlaceWorkspaceShell', () => {
  it('renders real primary routes, a signed-out account action, and an accessible family disclosure', () => {
    const markup = renderToStaticMarkup(
      <PlaceWorkspaceShell currentPage="explore" familyNavigation={familyNavigation}>본문</PlaceWorkspaceShell>,
    )

    expect(markup).toContain('href="/browse"')
    expect(markup).toContain('href="/settings"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('href="/api/auth/oidc/start"')
    expect(markup).toContain('href="/settings?tab=history"')
    expect(markup).toContain('aria-label="작업 내역 보기"')
    expect(markup).toContain('aria-label="패밀리 서비스 펼치기"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('role="search"')
    expect(markup).toContain('어두운 화면')
    expect(markup).not.toContain('준비 중</small>')
  })

  it('renders an authenticated account action without exposing session material', () => {
    const markup = renderToStaticMarkup(
      <PlaceWorkspaceShell
        account={{ href: '/profile', label: '김민지' }}
        currentPage="home"
        familyNavigation={familyNavigation}
      >본문</PlaceWorkspaceShell>,
    )

    expect(markup).toContain('href="/profile"')
    expect(markup).toContain('김민지')
    expect(markup).not.toMatch(/access_token|refresh_token|id_token/i)
  })
})
