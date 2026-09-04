import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBrowserSecurityHeaders } from './src/platform/security/browser-security-headers'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [...createBrowserSecurityHeaders(process.env.NODE_ENV === 'development')],
    }]
  },
}

export default nextConfig
