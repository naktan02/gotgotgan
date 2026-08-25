import { defineConfig, devices } from '@playwright/test'

const configuredBaseUrl = process.env.PLACE_WEB_E2E_BASE_URL
if (!configuredBaseUrl) {
  throw new Error('PLACE_WEB_E2E_BASE_URL is required; test environments own their address.')
}

const baseURL = new URL(configuredBaseUrl)
if (!/^[a-zA-Z0-9.-]+$/.test(baseURL.hostname) || !/^\d+$/.test(baseURL.port)) {
  throw new Error('PLACE_WEB_E2E_BASE_URL must include a safe hostname and explicit port.')
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: baseURL.toString(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
  ],
})
