import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { Client, Pool } from 'pg'

import databaseRuntime from '../../../deploy/database-runtime.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
const databaseTestHost = process.env.PLACE_DATABASE_TEST_HOST
const npmExecutable = process.env.npm_execpath

function run(executable, args, options = {}) {
  return execFileAsync(executable, args, { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024, ...options })
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

test('source evidence and canonical merge/split history remain immutable and traceable', { timeout: 90_000 }, async () => {
  assert.match(databaseTestHost ?? '', /^[a-zA-Z0-9.-]+$/)
  assert.ok(npmExecutable)
  const suffix = `${process.pid}-${Date.now()}`
  const containerName = `place-resolution-test-${suffix}`
  const secrets = await mkdtemp(path.join(os.tmpdir(), 'place-resolution-test-'))
  const administratorPassword = randomBytes(24).toString('base64url')
  const migrationPassword = randomBytes(24).toString('base64url')
  const runtimePassword = randomBytes(24).toString('base64url')
  let pool
  let runtimeClient

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
    assert.match(port ?? '', /^\d+$/)

    const administratorUrl = `postgresql://${databaseRuntime.roles.administrator}:${encodeURIComponent(administratorPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const migrationUrl = `postgresql://${databaseRuntime.roles.migration}:${encodeURIComponent(migrationPassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const runtimeUrl = `postgresql://${databaseRuntime.roles.runtime}:${encodeURIComponent(runtimePassword)}@${databaseTestHost}:${port}/${databaseRuntime.database}`
    const files = {
      PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE: path.join(secrets, 'administrator-url'),
      PLACE_MIGRATION_DATABASE_URL_FILE: path.join(secrets, 'migration-url'),
      PLACE_MIGRATION_DATABASE_PASSWORD_FILE: path.join(secrets, 'migration-password'),
      PLACE_DATABASE_PASSWORD_FILE: path.join(secrets, 'runtime-password'),
    }
    await waitForAuthenticatedConnection(administratorUrl)
    await Promise.all([
      writeFile(files.PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE, administratorUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_URL_FILE, migrationUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_PASSWORD_FILE, migrationPassword, { mode: 0o600 }),
      writeFile(files.PLACE_DATABASE_PASSWORD_FILE, runtimePassword, { mode: 0o600 }),
    ])
    await run(process.execPath, [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend'], {
      env: { ...process.env, ...files },
    })

    const ingestion = await import('../../dist/modules/ingestion/index.js')
    const places = await import('../../dist/modules/places/index.js')
    pool = new Pool({ connectionString: runtimeUrl, max: 2 })
    runtimeClient = new Client({ connectionString: runtimeUrl })
    await runtimeClient.connect()
    const ingestionStore = new ingestion.PostgresIngestionStore(pool)
    const placeStore = new places.PostgresCanonicalResolutionStore(pool)

    const observation = {
      id: '01992a20-d835-70ac-a165-ff91ed6cdb10',
      providerKey: 'naver', externalPlaceId: 'naver-42', acquisitionKind: 'structured-web',
      payloadChecksum: 'a'.repeat(64), parserVersion: 'naver-v1',
      observedAt: '2026-08-26T01:00:00.000Z', acquiredAt: '2026-08-26T01:00:01.000Z',
      facts: { name: '라멘집' }, confidence: 0.9, store: ingestionStore,
    }
    assert.deepEqual(await ingestion.recordSourceObservation(observation), { status: 'recorded' })
    assert.deepEqual(await ingestion.recordSourceObservation(observation), { status: 'replayed' })
    await assert.rejects(
      ingestion.recordSourceObservation({ ...observation, payloadChecksum: 'b'.repeat(64) }),
      ingestion.IngestionIdConflictError,
    )
    assert.deepEqual(await ingestion.recordPlaceCandidate({
      id: '01992a21-5c58-7df7-b45f-104376b413b9',
      sourceObservationId: observation.id, parserVersion: 'normalizer-v1', name: '라멘집',
      address: '서울 성동구', location: { latitude: 37.544, longitude: 127.056 }, attributes: {},
      createdAt: '2026-08-26T01:00:02.000Z', store: ingestionStore,
    }), { status: 'recorded' })
    assert.deepEqual(await ingestion.recordResolutionDecision({
      id: '01992a22-53aa-7966-82f4-108613428b92',
      candidateId: '01992a21-5c58-7df7-b45f-104376b413b9',
      decision: { kind: 'create-place', canonicalPlaceId: '01992a23-a324-75bf-af27-7c4658217f1e' },
      decidedBy: { kind: 'policy', reference: 'resolution-v1' }, evidenceObservationIds: [observation.id],
      rationale: 'no safe existing match', decidedAt: '2026-08-26T01:00:03.000Z', store: ingestionStore,
    }), { status: 'recorded' })

    const candidateId = '01992a21-5c58-7df7-b45f-104376b413b9'
    const recordDecision = (id, decision, requiresCandidate = false) => ingestion.recordResolutionDecision({
      id, ...(requiresCandidate ? { candidateId } : {}), decision,
      decidedBy: { kind: 'policy', reference: 'resolution-v1' },
      evidenceObservationIds: [observation.id], rationale: `integration decision ${decision.kind}`,
      decidedAt: '2026-08-26T01:00:03.000Z', store: ingestionStore,
    })
    const apply = (decisionId, command) => places.applyCanonicalResolution({
      decisionId, sourceDecisionId: decisionId, command,
      policyVersion: 'canonical-v1', occurredAt: '2026-08-26T02:00:00.000Z', store: placeStore,
    })
    const placeA = '01992a23-a324-75bf-af27-7c4658217f1e'
    const placeB = '01992a24-41f9-7ca8-a92d-5b2087bf8205'
    const placeC = '01992a25-e515-7970-bd3c-c0e72421b61d'
    const naverIdentity = { providerKey: 'naver', externalPlaceId: 'naver-42' }
    await assert.doesNotReject(apply('01992a22-53aa-7966-82f4-108613428b92', { kind: 'create-place', placeId: placeA, providerIdentity: naverIdentity }))
    await recordDecision('01992a31-c1e4-7f05-af9c-4dde56f34075', {
      kind: 'create-place', canonicalPlaceId: placeB,
    }, true)
    await apply('01992a31-c1e4-7f05-af9c-4dde56f34075', {
      kind: 'create-place', placeId: placeB,
      providerIdentity: { providerKey: 'google', externalPlaceId: 'google-99' },
    })
    await recordDecision('01992a32-2dbb-730e-aad6-5a5af6fbb837', {
      kind: 'merge-places', sourceCanonicalPlaceId: placeA, targetCanonicalPlaceId: placeB,
    })
    await apply('01992a32-2dbb-730e-aad6-5a5af6fbb837', { kind: 'merge-places', sourcePlaceId: placeA, targetPlaceId: placeB })
    assert.deepEqual(await placeStore.resolve(placeA), {
      status: 'active', placeId: placeB, redirectedFrom: [placeA],
    })
    await recordDecision('01992a33-21dd-720a-b030-1438fb3ecfeb', {
      kind: 'split-provider-identity', sourceCanonicalPlaceId: placeB,
      newCanonicalPlaceId: placeC, providerIdentity: naverIdentity,
    })
    await apply('01992a33-21dd-720a-b030-1438fb3ecfeb', {
      kind: 'split-provider-identity', sourcePlaceId: placeB, newPlaceId: placeC, providerIdentity: naverIdentity,
    })
    assert.deepEqual(await placeStore.resolveProviderIdentity(naverIdentity), {
      status: 'linked', placeId: placeC,
    })
    await recordDecision('01992a34-2a59-7d86-916c-fd85d146105a', {
      kind: 'retire-place', canonicalPlaceId: placeC,
    })
    await apply('01992a34-2a59-7d86-916c-fd85d146105a', { kind: 'retire-place', placeId: placeC })
    assert.deepEqual(await placeStore.resolve(placeC), {
      status: 'retired', placeId: placeC, redirectedFrom: [],
    })
    assert.deepEqual(await apply('01992a34-2a59-7d86-916c-fd85d146105a', { kind: 'retire-place', placeId: placeC }), { status: 'replayed' })

    const placeD = '01992a26-a596-7e34-8ca4-c0b84307b6be'
    const placeE = '01992a27-d2bd-7bcc-8bf2-bbed1610d2b4'
    await recordDecision('01992a35-e461-7df2-8e21-03fda7ef3afd', {
      kind: 'create-place', canonicalPlaceId: placeD,
    }, true)
    await apply('01992a35-e461-7df2-8e21-03fda7ef3afd', {
      kind: 'create-place', placeId: placeD,
      providerIdentity: { providerKey: 'kakao', externalPlaceId: 'kakao-d' },
    })
    await recordDecision('01992a36-1429-747b-954a-ddf847720356', {
      kind: 'create-place', canonicalPlaceId: placeE,
    }, true)
    await apply('01992a36-1429-747b-954a-ddf847720356', {
      kind: 'create-place', placeId: placeE,
      providerIdentity: { providerKey: 'kakao', externalPlaceId: 'kakao-e' },
    })
    const concurrentIdentity = { providerKey: 'google', externalPlaceId: 'google-race' }
    await recordDecision('01992a37-28b4-7c93-98d4-e2ca35b3387e', {
      kind: 'link-place', canonicalPlaceId: placeD,
    }, true)
    await recordDecision('01992a38-f8b3-75b6-b43a-f21fcd09a416', {
      kind: 'link-place', canonicalPlaceId: placeE,
    }, true)
    const concurrentOutcomes = await Promise.all([
      apply('01992a37-28b4-7c93-98d4-e2ca35b3387e', {
        kind: 'link-provider-identity', targetPlaceId: placeD, providerIdentity: concurrentIdentity,
      }),
      apply('01992a38-f8b3-75b6-b43a-f21fcd09a416', {
        kind: 'link-provider-identity', targetPlaceId: placeE, providerIdentity: concurrentIdentity,
      }),
    ])
    assert.deepEqual(concurrentOutcomes.map(({ status }) => status).sort(), [
      'applied', 'identity-already-linked',
    ])

    const untraceablePlace = '01992a28-b9d5-765d-b30b-1b3570d37628'
    const untraceableIdentity = { providerKey: 'naver', externalPlaceId: 'missing-decision' }
    await assert.rejects(apply('01992a39-2384-7a19-87d7-e388ab85853f', {
      kind: 'create-place', placeId: untraceablePlace, providerIdentity: untraceableIdentity,
    }), places.InvalidCanonicalResolutionError)
    assert.deepEqual(await placeStore.resolve(untraceablePlace), {
      status: 'not-found',
    })
    assert.deepEqual(await placeStore.resolveProviderIdentity(untraceableIdentity), {
      status: 'not-found',
    })

    await expectInsufficientPrivilege(runtimeClient, 'UPDATE ingestion.source_observations SET parser_version = \'forged\'')
    await expectInsufficientPrivilege(runtimeClient, 'DELETE FROM ingestion.resolution_decisions')
    await expectInsufficientPrivilege(runtimeClient, 'UPDATE places.canonical_place_redirects SET target_place_id = source_place_id')
    await expectInsufficientPrivilege(runtimeClient, 'DELETE FROM places.canonical_place_lineage_events')
  } finally {
    await runtimeClient?.end().catch(() => undefined)
    await pool?.end().catch(() => undefined)
    await run('docker', ['rm', '--force', containerName]).catch(() => undefined)
    await rm(secrets, { recursive: true, force: true })
  }
})
