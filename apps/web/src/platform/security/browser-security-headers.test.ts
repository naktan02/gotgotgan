import { describe, expect, it } from 'vitest'

import { browserSecurityHeaders, createBrowserSecurityHeaders } from './browser-security-headers'

describe('browser security headers', () => {
  it('allows the owned MapLibre worker and OpenFreeMap assets without wildcard origins', () => {
    const policy = browserSecurityHeaders.find(
      (header) => header.key === 'Content-Security-Policy',
    )?.value

    expect(policy).toContain("worker-src 'self' blob:")
    expect(policy).toContain('https://tiles.openfreemap.org')
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('*')
    expect(browserSecurityHeaders.find((header) => header.key === 'Referrer-Policy')?.value)
      .toBe('no-referrer')
  })

  it('allows React development diagnostics without weakening the production policy', () => {
    const policy = createBrowserSecurityHeaders(true).find(
      (header) => header.key === 'Content-Security-Policy',
    )?.value

    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
  })
})
