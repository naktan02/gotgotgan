import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBrowserSecurityHeaders } from './src/platform/security/browser-security-headers'
import { prepareMapAssets } from './src/platform/maps/build/prepare-map-assets'

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

export default function configureNext(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    prepareMapAssets(path.join(workspaceRoot, 'apps/web'))
  }
  return nextConfig
}
