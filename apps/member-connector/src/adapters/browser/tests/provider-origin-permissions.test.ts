import { describe, expect, it, vi } from 'vitest'

import {
  hasProviderOriginPermission,
  requestProviderOriginPermission,
} from '../webextensions/provider-origin-permissions.js'

describe('provider origin permissions', () => {
  it('checks and requests only the selected provider origin', async () => {
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
    }

    await expect(hasProviderOriginPermission(permissions, 'naver')).resolves.toBe(false)
    await expect(requestProviderOriginPermission(permissions, 'naver')).resolves.toBe(true)

    const exactPermission = { origins: ['https://pages.map.naver.com/*'] }
    expect(permissions.contains).toHaveBeenCalledWith(exactPermission)
    expect(permissions.request).toHaveBeenCalledWith(exactPermission)
  })
})
