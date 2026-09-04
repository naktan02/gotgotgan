function contentSecurityPolicy(development: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://tiles.openfreemap.org",
    "font-src 'self' data: https://tiles.openfreemap.org",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://tiles.openfreemap.org",
    "worker-src 'self' blob:",
  ].join('; ')
}

export function createBrowserSecurityHeaders(development = false) {
  return Object.freeze([
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(development) },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ])
}

export const browserSecurityHeaders = createBrowserSecurityHeaders()
