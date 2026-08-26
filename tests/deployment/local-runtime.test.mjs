import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const preparer = path.join(repositoryRoot, 'scripts', 'prepare-local-runtime.mjs')

test('local runtime preparation is secret-safe, resumable, and origin-bound', async () => {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'place-local-runtime-'))
  try {
    const environment = {
      ...process.env,
      PLACE_LOCAL_RUNTIME_ROOT: runtimeRoot,
      PLACE_LOCAL_PUBLIC_ORIGIN: 'http://localhost:3000',
      PLACE_LOCAL_IDENTITY_ORIGIN: 'http://identity.localhost',
    }
    const first = await execFileAsync(process.execPath, [preparer], {
      cwd: repositoryRoot,
      env: environment,
    })
    assert.equal(first.stderr, '')
    assert.equal(JSON.parse(first.stdout).state, 'identity-client-required')
    const databaseEnvironment = await readFile(
      path.join(runtimeRoot, 'database.env'),
      'utf8',
    )
    assert.match(databaseEnvironment, /^PLACE_DATA_NETWORK=place-data-local$/m)
    assert.doesNotMatch(databaseEnvironment, /postgresql:\/\//)

    const adminPasswordPath = path.join(
      runtimeRoot,
      'secrets',
      'place_postgres_admin_password',
    )
    const originalPassword = await readFile(adminPasswordPath, 'utf8')
    await writeFile(
      path.join(runtimeRoot, 'secrets', 'place_oidc_client_secret'),
      'test-only-client-secret\n',
      { mode: 0o600 },
    )
    const second = await execFileAsync(process.execPath, [preparer], {
      cwd: repositoryRoot,
      env: { ...environment, PLACE_LOCAL_OIDC_CLIENT_ID: 'place-local-client-id' },
    })
    assert.equal(second.stderr, '')
    assert.equal(JSON.parse(second.stdout).state, 'ready')
    assert.equal(await readFile(adminPasswordPath, 'utf8'), originalPassword)

    const composeEnvironment = await readFile(
      path.join(runtimeRoot, 'compose.env'),
      'utf8',
    )
    assert.match(composeEnvironment, /^PLACE_WEB_PUBLISHED_PORT=3000$/m)
    assert.match(composeEnvironment, /^PLACE_CONNECTOR_PUBLIC_ORIGIN=http:\/\/localhost:3000$/m)
    assert.match(composeEnvironment, /^PLACE_OIDC_ISSUER=http:\/\/identity\.localhost$/m)
    assert.match(composeEnvironment, /^PLACE_OIDC_CLIENT_ID=place-local-client-id$/m)
    assert.match(composeEnvironment, /^PLACE_WORKER_DATABASE_MAX_CONNECTIONS=2$/m)
    assert.match(composeEnvironment, /^PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS=30000$/m)
    assert.match(composeEnvironment, /^PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS=5000$/m)
    assert.match(composeEnvironment, /^PLACE_IMPORT_MATERIALIZATION_LEASE_MILLISECONDS=60000$/m)
    assert.match(composeEnvironment, /^PLACE_IMPORT_MATERIALIZATION_IDLE_MILLISECONDS=1000$/m)
    assert.doesNotMatch(composeEnvironment, /test-only-client-secret/)
    assert.doesNotMatch(composeEnvironment, new RegExp(originalPassword.trim()))
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
})

test('local runtime preparation rejects non-local HTTP origins', async () => {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'place-local-runtime-'))
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [preparer], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PLACE_LOCAL_RUNTIME_ROOT: runtimeRoot,
          PLACE_LOCAL_PUBLIC_ORIGIN: 'http://place.example',
          PLACE_LOCAL_IDENTITY_ORIGIN: 'http://identity.localhost',
        },
      }),
      (error) => error?.stderr?.includes('exact local HTTP origin'),
    )
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
})
