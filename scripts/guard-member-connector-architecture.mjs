import path from 'node:path'
import process from 'node:process'

import { inspectMemberConnectorArchitecture } from './lib/member-connector-architecture.mjs'

const violations = await inspectMemberConnectorArchitecture(
  path.resolve('apps/member-connector/src'),
)
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('Member connector architecture boundaries are valid.\n')
