import { describe, expect, it } from 'vitest'

import { detectConnectorBrowser } from '../webextensions/detect-browser.js'
import { WebExtensionInstallationStore } from '../webextensions/installation-store.js'

describe('WebExtensions browser adapters', () => {
  it('detects Whale before generic Chrome in the shared Chromium artifact', () => {
    expect(detectConnectorBrowser(
      'Mozilla/5.0 Chrome/128.0.0.0 Whale/3.28.266.14 Safari/537.36',
    )).toBe('whale')
    expect(detectConnectorBrowser(
      'Mozilla/5.0 Chrome/128.0.0.0 Edg/128.0.0.0 Safari/537.36',
    )).toBe('edge')
    expect(detectConnectorBrowser(
      'Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36',
    )).toBe('chrome')
    expect(detectConnectorBrowser(
      'Mozilla/5.0 Firefox/130.0',
    )).toBe('firefox')
  })

  it('creates one opaque installation reference and reuses it', async () => {
    const values: Record<string, unknown> = {}
    const storage = {
      get: async () => values,
      set: async (next: Record<string, unknown>) => { Object.assign(values, next) },
    }
    const store = new WebExtensionInstallationStore(
      storage,
      () => '01992d20-7000-7000-8000-000000000051',
    )
    await expect(store.getOrCreate()).resolves.toBe('01992d20-7000-7000-8000-000000000051')
    await expect(store.getOrCreate()).resolves.toBe('01992d20-7000-7000-8000-000000000051')
  })
})
