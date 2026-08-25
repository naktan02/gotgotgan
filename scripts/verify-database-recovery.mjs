import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { Client } from 'pg'

import databaseRuntime from '../deploy/database-runtime.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '..')

async function run(executable, args, options = {}) {
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
      await run('docker', [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        databaseRuntime.roles.administrator,
        '-d',
        databaseRuntime.database,
      ])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

async function startDatabase(containerName, passwordFile, host) {
  await run('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--platform',
    databaseRuntime.platform,
    '--publish',
    `${host}::5432`,
    '--env',
    `POSTGRES_DB=${databaseRuntime.database}`,
    '--env',
    `POSTGRES_USER=${databaseRuntime.roles.administrator}`,
    '--mount',
    `type=bind,source=${passwordFile},target=/run/secrets/place_recovery_admin_password,readonly`,
    '--env',
    'POSTGRES_PASSWORD_FILE=/run/secrets/place_recovery_admin_password',
    databaseRuntime.image,
  ])
  await waitUntilReady(containerName)
  const { stdout } = await run('docker', ['port', containerName, '5432/tcp'])
  const port = stdout.trim().split(':').at(-1)
  assert.match(port ?? '', /^\d+$/)
  return port
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

async function prepareDatabase({
  directory,
  prefix,
  administratorUrl,
  migrationUrl,
  migrationPassword,
  runtimePassword,
}) {
  const administratorUrlFile = path.join(directory, `${prefix}-administrator-url`)
  const migrationUrlFile = path.join(directory, `${prefix}-migration-url`)
  const migrationPasswordFile = path.join(directory, `${prefix}-migration-password`)
  const runtimePasswordFile = path.join(directory, `${prefix}-runtime-password`)
  await Promise.all([
    writeFile(administratorUrlFile, administratorUrl, { mode: 0o600 }),
    writeFile(migrationUrlFile, migrationUrl, { mode: 0o600 }),
    writeFile(migrationPasswordFile, migrationPassword, { mode: 0o600 }),
    writeFile(runtimePasswordFile, runtimePassword, { mode: 0o600 }),
  ])

  const npmExecutable = process.env.npm_execpath
  assert.ok(npmExecutable)
  await run(
    process.execPath,
    [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend'],
    {
      env: {
        ...process.env,
        PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: administratorUrlFile,
        PLACE_MIGRATION_DATABASE_URL_FILE: migrationUrlFile,
        PLACE_MIGRATION_DATABASE_PASSWORD_FILE: migrationPasswordFile,
        PLACE_DATABASE_PASSWORD_FILE: runtimePasswordFile,
      },
    },
  )
}

function connectionUrl({ host, port, role, password }) {
  return `postgresql://${role}:${encodeURIComponent(password)}@${host}:${port}/${databaseRuntime.database}`
}

async function createBrowserSession(connectionString, encryptionKey) {
  const { createOidcProcessRuntime } = await import(
    '../apps/web/src/platform/auth/oidc-process-runtime.ts'
  )
  const entropy = [
    'recovery-transaction-id',
    'recovery-state',
    'recovery-nonce',
    'recovery-pkce-verifier',
    'recovery-session-id',
  ]
  const runtime = await createOidcProcessRuntime({
    database: {
      connectionString,
      maxConnections: 1,
      idleTimeoutMilliseconds: 30_000,
      connectionTimeoutMilliseconds: 5_000,
    },
    encryption: {
      activeKey: { id: 'recovery-key-v1', value: encryptionKey },
    },
    bffConfig: {
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      postLoginPath: '/',
      scopes: ['openid'],
      transactionTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    },
    cleanupBatchSize: 10,
    provider: {
      buildAuthorizationUrl: async () => 'https://identity.example/oauth/v2/authorize',
      exchangeAuthorizationCode: async () => ({
        accessToken: 'recovery-access-token',
        refreshToken: 'recovery-refresh-token',
        expiresAt: '2026-08-26T04:00:00.000Z',
      }),
    },
    randomValue: () => entropy.shift(),
    calculatePkceChallenge: async () => 'recovery-pkce-challenge',
    now: () => new Date('2026-08-26T03:00:00.000Z'),
  })

  try {
    const startResponse = await runtime.bff.start()
    const transactionId = /__Host-place_oidc_tx=([^;]+)/.exec(
      startResponse.headers.get('set-cookie') ?? '',
    )?.[1]
    assert.equal(transactionId, 'recovery-transaction-id')
    const callbackResponse = await runtime.bff.callback(
      new Request(
        'https://place.example/api/auth/oidc/callback?code=recovery-code&state=recovery-state',
        { headers: { cookie: `__Host-place_oidc_tx=${transactionId}` } },
      ),
    )
    assert.equal(callbackResponse.status, 303)
    const sessionId = /__Host-place_session=([^;]+)/.exec(
      callbackResponse.headers.get('set-cookie') ?? '',
    )?.[1]
    assert.equal(sessionId, 'recovery-session-id')
    return sessionId
  } finally {
    await runtime.close()
  }
}

async function verifyBrowserSession(connectionString, encryptionKey, sessionId) {
  const { createOidcProcessRuntime } = await import(
    '../apps/web/src/platform/auth/oidc-process-runtime.ts'
  )
  const runtime = await createOidcProcessRuntime({
    database: {
      connectionString,
      maxConnections: 1,
      idleTimeoutMilliseconds: 30_000,
      connectionTimeoutMilliseconds: 5_000,
    },
    encryption: {
      activeKey: { id: 'recovery-key-v1', value: encryptionKey },
    },
    bffConfig: {
      callbackUrl: 'https://place.example/api/auth/oidc/callback',
      postLoginPath: '/',
      scopes: ['openid'],
      transactionTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    },
    cleanupBatchSize: 10,
    provider: {
      buildAuthorizationUrl: async () => {
        throw new Error('not used')
      },
      exchangeAuthorizationCode: async () => {
        throw new Error('not used')
      },
    },
    randomValue: () => {
      throw new Error('not used')
    },
    calculatePkceChallenge: async () => {
      throw new Error('not used')
    },
    now: () => new Date('2026-08-26T03:10:00.000Z'),
  })
  try {
    const session = await runtime.bff.resolveSession(
      new Request('https://place.example/', {
        headers: { cookie: `__Host-place_session=${sessionId}` },
      }),
    )
    assert.deepEqual(session, {
      id: 'recovery-session-id',
      tokens: {
        accessToken: 'recovery-access-token',
        refreshToken: 'recovery-refresh-token',
        expiresAt: '2026-08-26T04:00:00.000Z',
      },
      expiresAt: '2026-08-26T04:00:00.000Z',
    })
  } finally {
    await runtime.close()
  }
}

async function main() {
  const host = process.env.PLACE_DATABASE_TEST_HOST
  assert.match(host ?? '', /^[a-zA-Z0-9.-]+$/)
  const suffix = `${process.pid}-${Date.now()}`
  const sourceContainer = `place-recovery-source-${suffix}`
  const restoreContainer = `place-recovery-target-${suffix}`
  const directory = await mkdtemp(path.join(os.tmpdir(), 'place-recovery-'))
  const backupFile = path.join(directory, 'place.dump')

  const sourceAdministratorPassword = randomBytes(24).toString('base64url')
  const sourceMigrationPassword = randomBytes(24).toString('base64url')
  const sourceRuntimePassword = randomBytes(24).toString('base64url')
  const restoreAdministratorPassword = randomBytes(24).toString('base64url')
  const restoreMigrationPassword = randomBytes(24).toString('base64url')
  const restoreRuntimePassword = randomBytes(24).toString('base64url')
  const encryptionKey = randomBytes(32)

  let sourceClient
  let restoreClient
  let restoreAdministratorClient

  try {
    const sourceAdministratorPasswordFile = path.join(
      directory,
      'source-administrator-password',
    )
    const restoreAdministratorPasswordFile = path.join(
      directory,
      'restore-administrator-password',
    )
    await Promise.all([
      writeFile(sourceAdministratorPasswordFile, sourceAdministratorPassword, {
        mode: 0o600,
      }),
      writeFile(restoreAdministratorPasswordFile, restoreAdministratorPassword, {
        mode: 0o600,
      }),
    ])

    const sourcePort = await startDatabase(
      sourceContainer,
      sourceAdministratorPasswordFile,
      host,
    )
    const sourceAdministratorUrl = connectionUrl({
      host,
      port: sourcePort,
      role: databaseRuntime.roles.administrator,
      password: sourceAdministratorPassword,
    })
    const sourceMigrationUrl = connectionUrl({
      host,
      port: sourcePort,
      role: databaseRuntime.roles.migration,
      password: sourceMigrationPassword,
    })
    const sourceRuntimeUrl = connectionUrl({
      host,
      port: sourcePort,
      role: databaseRuntime.roles.runtime,
      password: sourceRuntimePassword,
    })
    await waitForConnection(sourceAdministratorUrl)
    await prepareDatabase({
      directory,
      prefix: 'source',
      administratorUrl: sourceAdministratorUrl,
      migrationUrl: sourceMigrationUrl,
      migrationPassword: sourceMigrationPassword,
      runtimePassword: sourceRuntimePassword,
    })

    sourceClient = new Client({ connectionString: sourceRuntimeUrl })
    await sourceClient.connect()
    await sourceClient.query(`
      INSERT INTO places.canonical_places (id, location)
      VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
        ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326)::geography
      )
    `)
    const sessionId = await createBrowserSession(sourceRuntimeUrl, encryptionKey)
    await sourceClient.end()
    sourceClient = undefined

    await run('docker', [
      'exec',
      sourceContainer,
      'pg_dump',
      '-U',
      databaseRuntime.roles.administrator,
      '-d',
      databaseRuntime.database,
      '--format=custom',
      '--file=/tmp/place.dump',
    ])
    await run('docker', [
      'cp',
      `${sourceContainer}:/tmp/place.dump`,
      backupFile,
    ])
    const backupBytes = await readFile(backupFile)
    for (const forbidden of [
      sourceAdministratorPassword,
      sourceMigrationPassword,
      sourceRuntimePassword,
      encryptionKey.toString('base64url'),
      'recovery-access-token',
      'recovery-refresh-token',
    ]) {
      assert.equal(backupBytes.includes(Buffer.from(forbidden)), false)
    }

    const restorePort = await startDatabase(
      restoreContainer,
      restoreAdministratorPasswordFile,
      host,
    )
    const restoreAdministratorUrl = connectionUrl({
      host,
      port: restorePort,
      role: databaseRuntime.roles.administrator,
      password: restoreAdministratorPassword,
    })
    const restoreMigrationUrl = connectionUrl({
      host,
      port: restorePort,
      role: databaseRuntime.roles.migration,
      password: restoreMigrationPassword,
    })
    const restoreRuntimeUrl = connectionUrl({
      host,
      port: restorePort,
      role: databaseRuntime.roles.runtime,
      password: restoreRuntimePassword,
    })
    await waitForConnection(restoreAdministratorUrl)
    await prepareDatabase({
      directory,
      prefix: 'restore',
      administratorUrl: restoreAdministratorUrl,
      migrationUrl: restoreMigrationUrl,
      migrationPassword: restoreMigrationPassword,
      runtimePassword: restoreRuntimePassword,
    })
    await run('docker', ['cp', backupFile, `${restoreContainer}:/tmp/place.dump`])
    await run('docker', [
      'exec',
      restoreContainer,
      'pg_restore',
      '-U',
      databaseRuntime.roles.administrator,
      '-d',
      databaseRuntime.database,
      '--clean',
      '--if-exists',
      '--exit-on-error',
      '/tmp/place.dump',
    ])

    const rejectedSourceCredentialUrl = connectionUrl({
      host,
      port: restorePort,
      role: databaseRuntime.roles.runtime,
      password: sourceRuntimePassword,
    })
    const rejectedClient = new Client({
      connectionString: rejectedSourceCredentialUrl,
    })
    await assert.rejects(
      rejectedClient.connect(),
      (error) => error?.code === '28P01',
    )
    await rejectedClient.end().catch(() => undefined)

    restoreAdministratorClient = new Client({
      connectionString: restoreAdministratorUrl,
    })
    restoreClient = new Client({ connectionString: restoreRuntimeUrl })
    await restoreAdministratorClient.connect()
    await restoreClient.connect()
    const databases = await restoreAdministratorClient.query(`
      SELECT datname
      FROM pg_database
      WHERE datallowconn AND NOT datistemplate
      ORDER BY datname
    `)
    assert.deepEqual(
      databases.rows.map((row) => row.datname),
      ['place', 'postgres'],
    )
    const restoredPlace = await restoreClient.query(`
      SELECT id, ST_X(location::geometry) AS longitude
      FROM places.canonical_places
      WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'
    `)
    assert.equal(restoredPlace.rows[0].id, '018f47c2-4a14-7c03-b8d5-6d91791e4d7f')
    assert.equal(Number(restoredPlace.rows[0].longitude), 127.0276)
    const restoredContract = await restoreAdministratorClient.query(`
      SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'places'
        AND tablename = 'canonical_places'
        AND indexname = 'canonical_places_location_gist'
    `)
    assert.equal(restoredContract.rowCount, 1)
    assert.match(restoredContract.rows[0].postgis_version, /^3\.5\./)
    assert.match(restoredContract.rows[0].indexdef, /USING gist \(location\)/)
    await assert.rejects(
      restoreClient.query(
        'CREATE TABLE places.recovery_runtime_must_not_create (id bigint)',
      ),
      (error) => error?.code === '42501',
    )
    await verifyBrowserSession(restoreRuntimeUrl, encryptionKey, sessionId)

    return {
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
    }
  } finally {
    await restoreClient?.end().catch(() => undefined)
    await restoreAdministratorClient?.end().catch(() => undefined)
    await sourceClient?.end().catch(() => undefined)
    await Promise.all([
      run('docker', ['rm', '--force', sourceContainer]).catch(() => undefined),
      run('docker', ['rm', '--force', restoreContainer]).catch(() => undefined),
    ])
    await rm(directory, { recursive: true, force: true })
  }
}

try {
  const evidence = await main()
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} catch {
  process.stderr.write('Database recovery verification failed\n')
  process.exitCode = 1
}
