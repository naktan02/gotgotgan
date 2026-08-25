import { expect, test } from '@playwright/test'

test('loads the Place shell and renders injected family destinations vertically', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '저장한 장소와 새로 찾을 장소를 한 흐름에서 관리합니다.' })).toBeVisible()
  const familyNavigation = page.getByRole('navigation', { name: '패밀리 서비스' })
  await expect(familyNavigation.getByRole('link')).toHaveCount(2)
  await expect(familyNavigation.getByRole('link').nth(0)).toHaveText('예시 서비스 하나')
  await expect(familyNavigation.getByRole('link').nth(1)).toHaveText('예시 서비스 둘')

  if (testInfo.project.name === 'mobile-chromium') {
    const menu = page.getByRole('button', { name: '메뉴 열기' })
    await expect(menu).toBeVisible()
    await menu.click()
    await expect(page.getByRole('navigation', { name: '장소 서비스' })).toBeVisible()
  }

  await expect(page).toHaveScreenshot('place-stage-two-shell.png', { fullPage: true })
})
