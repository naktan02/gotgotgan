import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { Client } from 'pg'

import databaseRuntime from '../../../deploy/database-runtime.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
const npmExecutable = process.env.npm_execpath
const databaseTestHost = process.env.PLACE_DATABASE_TEST_HOST

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

async function expectInsufficientPrivilege(client, sql) {
  await assert.rejects(client.query(sql), (error) => error?.code === '42501')
}

async function waitForAuthenticatedConnection(connectionString) {
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

test('database preparation migrates as owner and confines the runtime role', { timeout: 90_000 }, async () => {
  assert.match(
    databaseTestHost ?? '',
    /^[a-zA-Z0-9.-]+$/,
    'PLACE_DATABASE_TEST_HOST must contain a safe injected hostname',
  )
  const suffix = `${process.pid}-${Date.now()}`
  const containerName = `place-database-test-${suffix}`
  const secretDirectory = await mkdtemp(path.join(os.tmpdir(), 'place-database-test-'))
  const administratorPassword = randomBytes(24).toString('base64url')
  const migrationPassword = randomBytes(24).toString('base64url')
  const runtimePassword = randomBytes(24).toString('base64url')

  let runtimeClient
  let administratorClient

  try {
    const administratorPasswordFile = path.join(secretDirectory, 'administrator-password')
    await writeFile(administratorPasswordFile, administratorPassword, { mode: 0o600 })
    await run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--publish',
      `${databaseTestHost}::5432`,
      '--env',
      `POSTGRES_DB=${databaseRuntime.database}`,
      '--env',
      `POSTGRES_USER=${databaseRuntime.roles.administrator}`,
      '--mount',
      `type=bind,source=${administratorPasswordFile},target=/run/secrets/place_test_admin_password,readonly`,
      '--env',
      'POSTGRES_PASSWORD_FILE=/run/secrets/place_test_admin_password',
      databaseRuntime.image,
    ])
    await waitUntilReady(containerName)

    const { stdout: portOutput } = await run('docker', [
      'port',
      containerName,
      '5432/tcp',
    ])
    const port = portOutput.trim().split(':').at(-1)
    assert.match(port ?? '', /^\d+$/)

    const administratorUrl = `postgresql://${databaseRuntime.roles.administrator}:${encodeURIComponent(administratorPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const migrationUrl = `postgresql://${databaseRuntime.roles.migration}:${encodeURIComponent(migrationPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const runtimeUrl = `postgresql://${databaseRuntime.roles.runtime}:${encodeURIComponent(runtimePassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const administratorUrlFile = path.join(secretDirectory, 'administrator-url')
    const migrationUrlFile = path.join(secretDirectory, 'migration-url')
    const migrationPasswordFile = path.join(secretDirectory, 'migration-password')
    const runtimePasswordFile = path.join(secretDirectory, 'runtime-password')

    await waitForAuthenticatedConnection(administratorUrl)

    await Promise.all([
      writeFile(administratorUrlFile, administratorUrl, { mode: 0o600 }),
      writeFile(migrationUrlFile, migrationUrl, { mode: 0o600 }),
      writeFile(migrationPasswordFile, migrationPassword, { mode: 0o600 }),
      writeFile(runtimePasswordFile, runtimePassword, { mode: 0o600 }),
    ])

    const preparationEnvironment = {
      ...process.env,
      PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: administratorUrlFile,
      PLACE_MIGRATION_DATABASE_URL_FILE: migrationUrlFile,
      PLACE_MIGRATION_DATABASE_PASSWORD_FILE: migrationPasswordFile,
      PLACE_DATABASE_PASSWORD_FILE: runtimePasswordFile,
    }

    assert.ok(npmExecutable, 'npm_execpath is required to test the public workspace command')
    const npmCommand = [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend']
    await run(process.execPath, npmCommand, {
      env: preparationEnvironment,
    })
    await run(process.execPath, npmCommand, {
      env: preparationEnvironment,
    })

    administratorClient = new Client({ connectionString: administratorUrl })
    runtimeClient = new Client({ connectionString: runtimeUrl })
    await administratorClient.connect()
    await runtimeClient.connect()

    const rolesResult = await administratorClient.query(
      `
        SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname = ANY($1::text[])
        ORDER BY rolname
      `,
      [[databaseRuntime.roles.migration, databaseRuntime.roles.runtime]],
    )
    assert.deepEqual(
      rolesResult.rows,
      [databaseRuntime.roles.migration, databaseRuntime.roles.runtime]
        .sort()
        .map((rolname) => ({
          rolname,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        })),
    )
    const roleMemberships = await administratorClient.query(
      `
        SELECT 1
        FROM pg_auth_members memberships
        JOIN pg_roles members ON members.oid = memberships.member
        WHERE members.rolname = ANY($1::text[])
      `,
      [[databaseRuntime.roles.migration, databaseRuntime.roles.runtime]],
    )
    assert.equal(roleMemberships.rowCount, 0)

    const contractResult = await administratorClient.query(`
      SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis_version,
        (
          SELECT pg_get_userbyid(history.relowner)
          FROM pg_class history
          JOIN pg_namespace history_namespace ON history_namespace.oid = history.relnamespace
          WHERE history_namespace.nspname = 'place_migrations'
            AND history.relname = 'applied_migrations'
        ) AS migration_history_owner,
        pg_get_userbyid(c.relowner) AS table_owner,
        i.indexname,
        i.indexdef
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_indexes i
        ON i.schemaname = n.nspname
       AND i.tablename = c.relname
      WHERE n.nspname = 'places'
        AND c.relname = 'canonical_places'
        AND i.indexname = 'canonical_places_location_gist'
    `)
    assert.equal(contractResult.rowCount, 1)
    assert.match(contractResult.rows[0].postgis_version, /^3\.5\./)
    assert.equal(contractResult.rows[0].migration_history_owner, databaseRuntime.roles.migration)
    assert.equal(contractResult.rows[0].table_owner, databaseRuntime.roles.migration)
    assert.match(contractResult.rows[0].indexdef, /USING gist \(location\)/)

    await runtimeClient.query(`
      INSERT INTO places.canonical_places (id, location)
      VALUES (
        '018f47c2-4a14-7c03-b8d5-6d91791e4d7f',
        ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326)::geography
      )
    `)
    const readablePlace = await runtimeClient.query(`
      SELECT id
      FROM places.canonical_places
      WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'
    `)
    assert.equal(readablePlace.rows[0].id, '018f47c2-4a14-7c03-b8d5-6d91791e4d7f')

    await runtimeClient.query('SET enable_seqscan = off')
    const planResult = await runtimeClient.query(`
      EXPLAIN (FORMAT JSON)
      SELECT id
      FROM places.canonical_places
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(127.0276, 37.4979), 4326)::geography,
        1000
      )
    `)
    assert.match(JSON.stringify(planResult.rows[0]), /canonical_places_location_gist/)

    await expectInsufficientPrivilege(
      runtimeClient,
      'CREATE TABLE places.runtime_must_not_create_schema_objects (id bigint)',
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      `ALTER TABLE places.canonical_places OWNER TO ${databaseRuntime.roles.runtime}`,
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "INSERT INTO place_migrations.applied_migrations (name, run_on) VALUES ('forged', now())",
    )
    await expectInsufficientPrivilege(
      runtimeClient,
      "DELETE FROM places.canonical_places WHERE id = '018f47c2-4a14-7c03-b8d5-6d91791e4d7f'",
    )
  } finally {
    await runtimeClient?.end().catch(() => undefined)
    await administratorClient?.end().catch(() => undefined)
    await run('docker', ['rm', '--force', containerName]).catch(() => undefined)
    await rm(secretDirectory, { recursive: true, force: true })
  }
})
