import path from 'node:path'
import process from 'node:process'

import { inspectContractsArchitecture } from './lib/contracts-architecture.mjs'

const violations = await inspectContractsArchitecture(path.resolve('packages/contracts/src'))
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Contracts architecture boundaries are valid.\n')
