import { expect, test } from '@playwright/test'

test('renders the 곳곳간 shell and treats Family Services as a collapsible destination group', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.getByRole('link', { name: '곳곳간 홈' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '곳곳간 카탈로그 검색', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '로그인' })).toBeVisible()

  const menuButton = page.getByRole('button', { name: '메뉴 열기' })
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(page.getByRole('navigation', { name: '곳곳간 메뉴' })).toBeHidden()
    await menuButton.click()
  }

  const placeNavigation = page.getByRole('navigation', { name: '곳곳간 메뉴' })
  await expect(placeNavigation).toBeVisible()
  await expect(placeNavigation.getByRole('link', { name: '홈', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(placeNavigation.getByRole('link', { name: '내 곳곳간' })).toHaveAttribute('href', '/library')
  await expect(placeNavigation.getByRole('link', { name: '둘러보기' })).toHaveAttribute('href', '/browse')
  await expect(placeNavigation.getByRole('link', { name: '설정' })).toHaveAttribute('href', '/settings')

  const familyNavigation = page.getByRole('navigation', { name: '패밀리 서비스' })
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

  if (testInfo.project.name === 'mobile-chromium') {
    await page.keyboard.press('Escape')
    await expect(placeNavigation).toBeHidden()
    await expect(menuButton).toBeFocused()
  }
})
