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

test('personal content remains owned, repeatable, versioned, and privacy projected', { timeout: 90_000 }, async () => {
  assert.match(databaseTestHost ?? '', /^[a-zA-Z0-9.-]+$/)
  assert.ok(npmExecutable)
  const suffix = `${process.pid}-${Date.now()}`
  const containerName = `place-personal-content-${suffix}`
  const secrets = await mkdtemp(path.join(os.tmpdir(), 'place-personal-content-'))
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
    await waitForConnection(administratorUrl)
    await Promise.all([
      writeFile(files.PLACE_POSTGRES_ADMIN_DATABASE_URL_FILE, administratorUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_URL_FILE, migrationUrl, { mode: 0o600 }),
      writeFile(files.PLACE_MIGRATION_DATABASE_PASSWORD_FILE, migrationPassword, { mode: 0o600 }),
      writeFile(files.PLACE_DATABASE_PASSWORD_FILE, runtimePassword, { mode: 0o600 }),
    ])
    await run(process.execPath, [npmExecutable, 'run', 'database:prepare', '--workspace', '@place/backend'], { env: { ...process.env, ...files } })

    const library = await import('../../dist/modules/library/index.js')
    const visits = await import('../../dist/modules/visits/index.js')
    const writing = await import('../../dist/modules/writing/index.js')
    pool = new Pool({ connectionString: runtimeUrl, max: 2 })
    runtimeClient = new Client({ connectionString: runtimeUrl })
    await runtimeClient.connect()
    const libraryStore = new library.PostgresLibraryStore(pool)
    const visitStore = new visits.PostgresVisitStore(pool)
    const writingStore = new writing.PostgresWritingStore(pool)
    const memberId = '01992d10-0000-7000-8000-000000000001'
    const placeId = '01992d10-0000-7000-8000-000000000002'
    const placeTwo = '01992d10-0000-7000-8000-000000000003'
    const at = '2026-08-26T10:00:00.000Z'
    await runtimeClient.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES ($1,'https://identity.example.test','member-1','active','member','standard','unclassified',$2,$2)`,
      [memberId, at],
    )
    await runtimeClient.query('INSERT INTO places.canonical_places (id) VALUES ($1), ($2)', [placeId, placeTwo])

    const preference = (commandId, personalRating) => library.applyLibraryCommand({
      commandId, memberId, occurredAt: at,
      command: { kind: 'set-place-preferences', placeId, saved: true, wanted: false, personalRating },
      store: libraryStore,
    })
    assert.deepEqual(await preference('01992d10-0000-7000-8000-000000000010', 4.4), { status: 'applied' })
    assert.deepEqual(await preference('01992d10-0000-7000-8000-000000000011', 4.7), { status: 'applied' })
    assert.equal((await libraryStore.getPlacePreferences(memberId, placeId)).personalRating, 4.7)
    assert.equal((await runtimeClient.query('SELECT count(*)::int AS count FROM library.personal_rating_events')).rows[0].count, 2)

    for (const [id, visitedAt] of [
      ['01992d10-0000-7000-8000-000000000020', '2026-07-01T12:00:00.000Z'],
      ['01992d10-0000-7000-8000-000000000021', '2026-08-01T12:00:00.000Z'],
    ]) await visits.recordVisit({ id, memberId, placeId, visitedAt, recordedAt: at, store: visitStore })
    assert.deepEqual(await visits.summarizeVisits(memberId, placeId, visitStore), {
      visited: true, count: 2,
      firstVisitedAt: '2026-07-01T12:00:00.000Z', lastVisitedAt: '2026-08-01T12:00:00.000Z',
    })
    assert.equal((await visitStore.list(memberId, placeId)).length, 2)

    const publicCollectionId = '01992d10-0000-7000-8000-000000000030'
    const publicCollectionPublication = '01992d10-0000-7000-8000-000000000031'
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000032', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'create-collection', collectionId: publicCollectionId, name: 'Public map', visibility: 'unlisted', publicationId: publicCollectionPublication,
    } })
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000033', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'add-collection-place', collectionId: publicCollectionId, placeId, position: 0,
    } })
    const published = await libraryStore.getPublishedCollection(publicCollectionPublication)
    assert.deepEqual(Object.keys(published).sort(), ['description', 'name', 'places', 'publicationId', 'updatedAt', 'visibility'])
    assert.equal(published.places[0].placeId, placeId)

    const privateCollectionId = '01992d10-0000-7000-8000-000000000034'
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000035', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'create-collection', collectionId: privateCollectionId, name: 'Private map', visibility: 'private',
    } })
    assert.equal(await libraryStore.getPublishedCollection(privateCollectionId), undefined)
    const memberLibrary = await libraryStore.getMemberLibrary(memberId)
    assert.equal(memberLibrary.places[0].personalRating, 4.7)
    assert.equal(memberLibrary.collections.length, 2)
    assert.deepEqual(memberLibrary.tags, [])

    const entryId = '01992d10-0000-7000-8000-000000000040'
    const writingPublication = '01992d10-0000-7000-8000-000000000041'
    assert.deepEqual(await writing.applyWritingCommand({ commandId: '01992d10-0000-7000-8000-000000000042', memberId, occurredAt: at, store: writingStore, command: {
      kind: 'create-entry', documentId: entryId, title: 'Two places', body: 'Long entry', placeIds: [placeId, placeTwo], visibility: 'public', publicationId: writingPublication,
    } }), { status: 'applied', documentId: entryId, version: 1 })
    assert.deepEqual(await writing.applyWritingCommand({ commandId: '01992d10-0000-7000-8000-000000000043', memberId, occurredAt: at, store: writingStore, command: {
      kind: 'update-entry', documentId: entryId, expectedVersion: 1, title: 'Two places revised', body: 'Long entry revised', placeIds: [placeTwo, placeId], visibility: 'public', publicationId: writingPublication,
    } }), { status: 'applied', documentId: entryId, version: 2 })
    const publicWriting = await writingStore.getPublished(writingPublication)
    assert.deepEqual(Object.keys(publicWriting).sort(), ['body', 'kind', 'placeIds', 'publicationId', 'title', 'updatedAt', 'visibility'])
    assert.equal((await runtimeClient.query('SELECT count(*)::int AS count FROM writing.document_revisions WHERE document_id = $1', [entryId])).rows[0].count, 2)
    assert.deepEqual((await writingStore.listMemberWriting(memberId))[0], {
      documentId: entryId, kind: 'entry', title: 'Two places revised', body: 'Long entry revised',
      visibility: 'public', publicationId: writingPublication, version: 2,
      placeIds: [placeTwo, placeId], updatedAt: at,
    })

    await assert.rejects(runtimeClient.query(`UPDATE visits.visit_occurrences SET visited_at = CURRENT_TIMESTAMP`), (error) => error?.code === '42501')
    await assert.rejects(runtimeClient.query(`DELETE FROM library.personal_rating_events`), (error) => error?.code === '42501')
    await assert.rejects(runtimeClient.query(`UPDATE writing.document_revisions SET body = 'rewritten'`), (error) => error?.code === '42501')
  } finally {
    await pool?.end().catch(() => undefined)
    await runtimeClient?.end().catch(() => undefined)
    await run('docker', ['rm', '--force', containerName]).catch(() => undefined)
    await rm(secrets, { recursive: true, force: true })
  }
})
