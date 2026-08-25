import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
const recoveryVerifier = path.join(
  repositoryRoot,
  'scripts',
  'verify-database-recovery.mjs',
)

test(
  'database backup restores Place data and encrypted browser state in isolation',
  { timeout: 120_000 },
  async () => {
    const databaseTestHost = process.env.PLACE_DATABASE_TEST_HOST
    assert.match(
      databaseTestHost ?? '',
      /^[a-zA-Z0-9.-]+$/,
      'PLACE_DATABASE_TEST_HOST must contain a safe injected hostname',
    )

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [recoveryVerifier],
      {
        cwd: repositoryRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    )

    assert.equal(stderr, '')
    assert.deepEqual(JSON.parse(stdout), {
      schemaVersion: 'place-database-recovery-evidence.v1',
      deliveryState: 'source-only',
      backup: {
        unit: 'database',
        format: 'postgresql-custom',
        credentialMaterial: 'absent',
        browserPayload: 'encrypted',
      },
      restore: {
        environment: 'isolated',
        sourceCredentials: 'rejected',
        postgis: 'verified',
        spatialIndex: 'verified',
        canonicalData: 'verified',
        runtimeDdl: 'denied',
        browserSessionKeyRecovery: 'verified',
      },
    })
  },
)
