import { expect, test } from '@playwright/test'

test('renders the 곳곳간 shell and treats Family Services as a collapsible destination group', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: '곳곳간 홈' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '곳곳간 카탈로그 검색', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '로그인' })).toBeVisible()

  const placeNavigation = page.getByRole('navigation', { name: '곳곳간 메뉴' })
  await expect(placeNavigation).toBeVisible()
  await expect(placeNavigation.getByRole('link', { name: '홈', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(placeNavigation.getByRole('link', { name: '내 곳곳간' })).toHaveAttribute('href', '/library')
  await expect(placeNavigation.getByRole('link', { name: '둘러보기' })).toHaveAttribute('href', '/browse')
  await expect(placeNavigation.getByRole('link', { name: '설정' })).toHaveAttribute('href', '/settings')

  const familyNavigation = page.getByRole('navigation', { name: '패밀리 서비스' })
  await familyNavigation.getByRole('button', { name: '패밀리 서비스 펼치기' }).click()
  const collapse = familyNavigation.getByRole('button', { name: '패밀리 서비스 접기' })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  const familyLinks = familyNavigation.getByRole('link')
  await expect(familyLinks).toHaveCount(2)
  await expect(familyLinks.nth(0)).toContainText('예시 서비스 하나')
  await expect(familyLinks.nth(1)).toContainText('예시 서비스 둘')

  await collapse.click()
  const expand = familyNavigation.getByRole('button', { name: '패밀리 서비스 펼치기' })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect(familyLinks.nth(0)).toBeHidden()
  await expect(familyLinks.nth(1)).toBeHidden()

  await expand.click()
  await expect(familyLinks.nth(0)).toBeVisible()
  await expect(familyLinks.nth(1)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(placeNavigation).toBeVisible()
  await expect(familyNavigation.getByRole('button', { name: '패밀리 서비스 펼치기' })).toBeFocused()
  const header = page.getByRole('banner')
  await expect(header.getByRole('textbox')).toHaveCount(0)
  await header.getByRole('button', { name: '어두운 화면' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await header.getByRole('button', { name: '어두운 화면' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('keeps the authenticated profile and POST logout reachable on a narrow screen', async ({ page }) => {
  await page.route('**/api/profile', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 'public-profile-record.v1', handle: 'ramen-log',
      displayName: '라멘 기록', visibility: 'hidden',
      createdAt: '2026-08-29T10:00:00.000Z', updatedAt: '2026-08-29T10:00:00.000Z',
    }),
  }))
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: '라멘 기록 프로필과 계정' })).toBeVisible()
  await expect(header.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible()
  await expect(header.locator('form')).toHaveAttribute('action', '/api/auth/logout')
  await expect(header.locator('form')).toHaveAttribute('method', 'post')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
