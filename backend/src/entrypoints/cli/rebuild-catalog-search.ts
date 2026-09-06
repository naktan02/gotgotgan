import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createMinimumPlacePublication } from '../catalog/minimum-place-publication.js'

let pool: Pool | undefined
try {
  const file = process.env.PLACE_DATABASE_URL_FILE
  if (!file) throw new Error('Missing protected runtime database URL file')
  const connectionString = (await readFile(file, 'utf8')).replace(/\r?\n$/, '')
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password ||
    !url.hostname || url.pathname.length < 2 || /[\r\n]/.test(connectionString)) throw new Error('Invalid database configuration')
  pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
  const result = await createMinimumPlacePublication(pool).rebuild()
  process.stdout.write(`Minimum catalog projection: ${result.projected} processed; ${result.skipped} non-minimum profiles skipped; sequence ${result.afterSequence}.\n`)
} catch {
  process.stderr.write('Canonical search rebuild failed. Current place facts were preserved; retry is safe.\n')
  process.exitCode = 1
} finally { await pool?.end() }
