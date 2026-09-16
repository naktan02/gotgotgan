import { describe, expect, it } from 'vitest'

import { adminBrowserAuthApplication } from './admin-oidc-lifecycle'

describe('administrator browser authentication namespace', () => {
  it('uses application-specific environment, storage, cookie, and lifecycle identities', () => {
    expect(adminBrowserAuthApplication).toEqual({
      storageNamespace: 'place.admin-browser-auth.v1',
      environmentPrefix: 'PLACE_ADMIN',
      transactionCookieName: '__Host-place_admin_oidc_tx',
      sessionCookieName: '__Host-place_admin_session',
      lifecycleKey: 'place.admin-web.oidc.lifecycle',
    })
    expect(adminBrowserAuthApplication.transactionCookieName).not.toBe('__Host-place_oidc_tx')
    expect(adminBrowserAuthApplication.sessionCookieName).not.toBe('__Host-place_session')
  })
})
