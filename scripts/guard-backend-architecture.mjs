import path from 'node:path'
import process from 'node:process'

import { inspectBackendArchitecture } from './lib/backend-architecture.mjs'

const violations = await inspectBackendArchitecture(path.resolve('backend/src'))
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Backend architecture boundaries are valid.\n')
