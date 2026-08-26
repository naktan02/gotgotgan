import path from 'node:path'
import process from 'node:process'

import { inspectFrontendArchitecture } from '@naktan02/frontend-architecture'
import { frontendArchitecturePolicy } from './frontend-architecture-policy.mjs'

const violations = await inspectFrontendArchitecture(
  path.resolve('apps/web/src'),
  frontendArchitecturePolicy,
)
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Frontend architecture boundaries are valid.\n')
