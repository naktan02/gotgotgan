import { prepareDatabase } from '../../platform/database/prepare-database.js'

const result = await prepareDatabase()
if (result.ok) {
  process.stdout.write(
    `Database preparation completed; ${result.appliedMigrations} migration(s) applied.\n`,
  )
} else {
  process.stderr.write(`${result.message}\n`)
  process.exitCode = 1
}
