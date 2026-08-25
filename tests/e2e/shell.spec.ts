import { expect, test } from '@playwright/test'

test('loads the deterministic Place shell', async ({ page }, testInfo) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '장소를 다루기 위한 기반을 만들고 있습니다.' })).toBeVisible()
  await expect(page.getByText('연결 계약 준비 중')).toBeAttached()

  if (testInfo.project.name === 'mobile-chromium') {
    const menu = page.getByRole('button', { name: '메뉴 열기' })
    await expect(menu).toBeVisible()
    await menu.click()
    await expect(page.getByRole('navigation', { name: '장소 서비스' })).toBeVisible()
  }

  await expect(page).toHaveScreenshot('place-stage-one-shell.png', { fullPage: true })
})
