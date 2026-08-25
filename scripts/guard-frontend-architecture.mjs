import path from 'node:path'
import process from 'node:process'

import { inspectFrontendArchitecture } from './lib/frontend-architecture.mjs'

const violations = await inspectFrontendArchitecture(path.resolve('apps/web/src'))
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Frontend architecture boundaries are valid.\n')
