import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLACE_ADMIN_E2E_BASE_URL
if (!baseURL) throw new Error('PLACE_ADMIN_E2E_BASE_URL is required')

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', fullyParallel: false,
  use: { baseURL, screenshot: 'only-on-failure' },
  projects: [
    { name: 'admin-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'admin-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
