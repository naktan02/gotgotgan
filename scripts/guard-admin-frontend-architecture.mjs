import path from 'node:path'
import process from 'node:process'

import { inspectFrontendArchitecture } from '@naktan02/frontend-architecture'
import { frontendArchitecturePolicy } from './frontend-architecture-policy.mjs'
import { inspectFrontendLayout } from './lib/frontend-layout.mjs'

const sourceRoot = path.resolve('apps/admin-web/src')
const violations = [
  ...await inspectFrontendArchitecture(sourceRoot, frontendArchitecturePolicy),
  ...await inspectFrontendLayout(sourceRoot),
]
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Admin frontend architecture boundaries are valid.\n')
