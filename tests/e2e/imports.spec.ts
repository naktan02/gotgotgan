import { expect, test } from '@playwright/test'

test('legacy imports entry redirects to the canonical web import tab', async ({ page }) => {
  await page.goto('/imports')

  await expect(page).toHaveURL(/\/settings\?tab=import$/)
  await expect(page.getByRole('tab', { name: '데이터 가져오기' })).toHaveAttribute('aria-selected', 'true')
})
