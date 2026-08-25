import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
}

export default nextConfig
