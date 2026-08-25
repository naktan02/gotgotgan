import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { Client, Pool } from 'pg'

import databaseRuntime from '../../../../deploy/database-runtime.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../../../..')

function run(executable, args, options = {}) {
  return execFileAsync(executable, args, {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  })
}

async function waitUntilReady(containerName) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run('docker', ['exec', containerName, 'pg_isready', '-U', databaseRuntime.roles.administrator, '-d', databaseRuntime.database])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

async function waitForConnection(connectionString) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new Client({ connectionString })
    try {
      await client.connect()
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

export async function startPreparedPlaceDatabase(prefix) {
  const databaseTestHost = process.env.PLACE_DATABASE_TEST_HOST
  const npmExecutable = process.env.npm_execpath
  if (!/^[a-zA-Z0-9.-]+$/.test(databaseTestHost ?? '') || !npmExecutable) {
    throw new Error('PLACE_DATABASE_TEST_HOST and npm_execpath are required')
  }
  const suffix = `${process.pid}-${Date.now()}`
  const containerName = `${prefix}-${suffix}`
  const secrets = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const administratorPassword = randomBytes(24).toString('base64url')
  const migrationPassword = randomBytes(24).toString('base64url')
  const runtimePassword = randomBytes(24).toString('base64url')
  let pool
  let administratorClient

  try {
    const administratorPasswordFile = path.join(secrets, 'administrator-password')
    await writeFile(administratorPasswordFile, administratorPassword, { mode: 0o600 })
    await run('docker', [
      'run', '--detach', '--rm', '--name', containerName,
      '--publish', `${databaseTestHost}::5432`,
      '--env', `POSTGRES_DB=${databaseRuntime.database}`,
      '--env', `POSTGRES_USER=${databaseRuntime.roles.administrator}`,
      '--mount', `type=bind,source=${administratorPasswordFile},target=/run/secrets/place_test_admin_password,readonly`,
      '--env', 'POSTGRES_PASSWORD_FILE=/run/secrets/place_test_admin_password',
      databaseRuntime.image,
    ])
    await waitUntilReady(containerName)
    const { stdout } = await run('docker', ['port', containerName, '5432/tcp'])
    const port = stdout.trim().split(':').at(-1)
    if (!/^\d+$/.test(port ?? '')) throw new Error('PostgreSQL test port is invalid')
    const administratorUrl = `postgresql://${databaseRuntime.roles.administrator}:${encodeURIComponent(administratorPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const migrationUrl = `postgresql://${databaseRuntime.roles.migration}:${encodeURIComponent(migrationPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const runtimeUrl = `postgresql://${databaseRuntime.roles.runtime}:${encodeURIComponent(runtimePassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const files = {
      PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: path.join(secrets, 'administrator-url'),
      PLACE_MIGRATION_DATABASE_URL_FILE: path.join(secrets, 'migration-url'),
      PLACE_MIGRATION_DATABASE_PASSWORD_FILE: path.join(secrets, 'migration-password'),
      PLACE_DATABASE_PASSWORD_FILE: path.join(secrets, 'runtime-password'),
    }
    await waitForConnection(administratorUrl)
    await Promise.all([
      writeFile(files.PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE, administratorUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_URL_FILE, migrationUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_PASSWORD_FILE, migrationPassword, { mode: 0o600 }),
      writeFile(files.PLACE_DATABASE_PASSWORD_FILE, runtimePassword, { mode: 0o600 }),
    ])
    await run(process.execPath, [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend'], {
      env: { ...process.env, ...files },
    })

    pool = new Pool({ connectionString: runtimeUrl, max: 5 })
    administratorClient = new Client({ connectionString: administratorUrl })
    await administratorClient.connect()
    return {
      pool,
      administratorClient,
      async close() {
        await pool?.end().catch(() => undefined)
        await administratorClient?.end().catch(() => undefined)
        await run('docker', ['stop', '--time', '1', containerName]).catch(() => undefined)
        await rm(secrets, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await pool?.end().catch(() => undefined)
    await administratorClient?.end().catch(() => undefined)
    await run('docker', ['stop', '--time', '1', containerName]).catch(() => undefined)
    await rm(secrets, { recursive: true, force: true })
    throw error
  }
}
