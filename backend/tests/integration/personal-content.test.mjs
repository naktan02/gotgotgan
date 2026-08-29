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
    const libraryQueries = new library.PostgresLibraryQueries(pool, async () => [])
    const visitStore = new visits.PostgresVisitStore(pool)
    const visitQueries = new visits.PostgresVisitQueries(pool)
    const writingStore = new writing.PostgresWritingStore(pool)
    const writingQueries = new writing.PostgresWritingQueries(pool)
    const memberId = '01992d10-0000-7000-8000-000000000001'
    const viewerMemberId = '01992d10-0000-7000-8000-000000000004'
    const placeId = '01992d10-0000-7000-8000-000000000002'
    const placeTwo = '01992d10-0000-7000-8000-000000000003'
    const at = '2026-08-26T10:00:00.000Z'
    await runtimeClient.query(
      `INSERT INTO access.memberships
        (id, issuer, subject, status, authority_role, product_tier, user_grade, created_at, updated_at)
       VALUES
         ($1,'https://identity.example.test','member-1','active','member','standard','unclassified',$3,$3),
         ($2,'https://identity.example.test','member-2','active','member','standard','unclassified',$3,$3)`,
      [memberId, viewerMemberId, at],
    )
    await runtimeClient.query('INSERT INTO places.canonical_places (id) VALUES ($1), ($2)', [placeId, placeTwo])

    const preference = (commandId, personalRating, expectedUpdatedAt) => library.applyLibraryCommand({
      commandId, memberId, occurredAt: at,
      command: {
        kind: 'set-place-preferences', placeId, expectedUpdatedAt,
        saved: true, wanted: false, personalRating,
      },
      store: libraryStore,
    })
    assert.deepEqual(
      await preference('01992d10-0000-7000-8000-000000000010', 4.4, null),
      { status: 'applied' },
    )
    assert.deepEqual(
      await preference('01992d10-0000-7000-8000-000000000011', 4.7, at),
      { status: 'applied' },
    )
    assert.deepEqual(
      await preference('01992d10-0000-7000-8000-000000000011', 4.7, at),
      { status: 'replayed' },
    )
    await assert.rejects(
      preference('01992d10-0000-7000-8000-000000000012', 3.2, at),
      (error) => error instanceof library.LibraryPreferenceVersionConflictError,
    )
    const currentPreference = await libraryStore.getPlacePreferences(memberId, placeId)
    assert.equal(currentPreference.personalRating, 4.7)
    assert.equal(currentPreference.updatedAt, '2026-08-26T10:00:00.001Z')
    const concurrent = await Promise.allSettled([
      library.applyLibraryCommand({
        commandId: '01992d10-0000-7000-8000-000000000013', memberId, occurredAt: at,
        command: {
          kind: 'set-place-preferences', placeId: placeTwo, expectedUpdatedAt: null,
          saved: true, wanted: false, personalRating: null,
        },
        store: libraryStore,
      }),
      library.applyLibraryCommand({
        commandId: '01992d10-0000-7000-8000-000000000014', memberId, occurredAt: at,
        command: {
          kind: 'set-place-preferences', placeId: placeTwo, expectedUpdatedAt: null,
          saved: false, wanted: true, personalRating: null,
        },
        store: libraryStore,
      }),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter((result) => (
      result.status === 'rejected' &&
      result.reason instanceof library.LibraryPreferenceVersionConflictError
    )).length, 1)
    assert.equal((await runtimeClient.query('SELECT count(*)::int AS count FROM library.personal_rating_events')).rows[0].count, 2)

    for (const [id, visitedAt] of [
      ['01992d10-0000-7000-8000-000000000020', '2026-07-01T12:00:00.000Z'],
      ['01992d10-0000-7000-8000-000000000021', '2026-08-01T12:00:00.000Z'],
    ]) await visits.recordVisit({ id, memberId, placeId, visitedAt, recordedAt: at, store: visitStore })
    assert.deepEqual(await visitStore.summarize(memberId, placeId), {
      visited: true, count: 2,
      firstVisitedAt: '2026-07-01T12:00:00.000Z', lastVisitedAt: '2026-08-01T12:00:00.000Z',
    })
    assert.equal((await visitQueries.listPlaceVisits({ memberId, placeId, limit: 20 })).items.length, 2)

    const publicCollectionId = '01992d10-0000-7000-8000-000000000030'
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000032', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'create-collection', collectionId: publicCollectionId, name: 'Public map',
    } })
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000033', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'add-collection-place', collectionId: publicCollectionId, placeId, position: 0,
    } })
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000036', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'set-collection-publication', collectionId: publicCollectionId,
      expectedUpdatedAt: at, visibility: 'unlisted',
    } })
    let ownedCollection = await libraryQueries.getCollection({
      memberId, collectionId: publicCollectionId, limit: 20,
    })
    const publicCollectionPublication = ownedCollection.collection.publicationId
    assert.ok(publicCollectionPublication)
    const published = await libraryQueries.getPublishedCollection({
      publicationId: publicCollectionPublication, limit: 50,
    })
    assert.deepEqual(Object.keys(published).sort(), ['description', 'name', 'placeCount', 'places', 'publicationId', 'updatedAt', 'visibility'])
    assert.equal(published.places[0].placeId, placeId)
    assert.equal(published.places[0].place, null)

    await assert.rejects(
      library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000060', memberId, occurredAt: at, store: libraryStore, command: {
        kind: 'set-collection-publication', collectionId: publicCollectionId,
        expectedUpdatedAt: at, visibility: 'public',
      } }),
      { name: 'LibraryCollectionVersionConflictError' },
    )
    assert.equal((await libraryQueries.getPublishedCollection({
      publicationId: publicCollectionPublication, limit: 50,
    })).visibility, 'unlisted')

    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000037', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'set-collection-publication', collectionId: publicCollectionId,
      expectedUpdatedAt: ownedCollection.collection.updatedAt, visibility: 'public',
    } })
    ownedCollection = await libraryQueries.getCollection({
      memberId, collectionId: publicCollectionId, limit: 20,
    })
    assert.equal(ownedCollection.collection.publicationId, publicCollectionPublication)
    assert.equal((await libraryQueries.getPublishedCollection({
      publicationId: publicCollectionPublication, limit: 50,
    })).visibility, 'public')

    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000038', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'set-collection-publication', collectionId: publicCollectionId,
      expectedUpdatedAt: ownedCollection.collection.updatedAt, visibility: 'private',
    } })
    assert.equal(await libraryQueries.getPublishedCollection({
      publicationId: publicCollectionPublication, limit: 50,
    }), undefined)
    ownedCollection = await libraryQueries.getCollection({
      memberId, collectionId: publicCollectionId, limit: 20,
    })
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000039', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'set-collection-publication', collectionId: publicCollectionId,
      expectedUpdatedAt: ownedCollection.collection.updatedAt, visibility: 'unlisted',
    } })
    ownedCollection = await libraryQueries.getCollection({
      memberId, collectionId: publicCollectionId, limit: 20,
    })
    const replacementPublication = ownedCollection.collection.publicationId
    assert.ok(replacementPublication)
    assert.notEqual(replacementPublication, publicCollectionPublication)

    const copiedCollectionId = '01992d10-0000-7000-8000-000000000050'
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000051', memberId: viewerMemberId, occurredAt: at, store: libraryStore, command: {
      kind: 'copy-published-collection', sourcePublicationId: replacementPublication,
      targetCollectionId: copiedCollectionId, targetName: 'Copied map',
    } })
    const copied = await libraryQueries.getCollection({
      memberId: viewerMemberId, collectionId: copiedCollectionId, limit: 20,
    })
    assert.equal(copied.collection.visibility, 'private')
    assert.equal(copied.collection.publicationId, null)
    assert.deepEqual(copied.places.map((item) => item.placeId), [placeId])
    assert.equal((await runtimeClient.query(
      `SELECT source_publication_id FROM library.collection_copy_provenance
       WHERE target_collection_id = $1`, [copiedCollectionId],
    )).rows[0].source_publication_id, replacementPublication)

    const privateCollectionId = '01992d10-0000-7000-8000-000000000034'
    await library.applyLibraryCommand({ commandId: '01992d10-0000-7000-8000-000000000035', memberId, occurredAt: at, store: libraryStore, command: {
      kind: 'create-collection', collectionId: privateCollectionId, name: 'Private map',
    } })
    assert.equal(await libraryQueries.getPublishedCollection({
      publicationId: privateCollectionId, limit: 50,
    }), undefined)
    const savedPlaces = await libraryQueries.listPlaces({
      memberId, state: 'saved', tagIds: [], tagMatch: 'all',
      areaKeys: [], taxonomyKeys: [], limit: 50,
    })
    const collections = await libraryQueries.listCollections({ memberId, limit: 50 })
    const tags = await libraryQueries.listTags({ memberId, limit: 50 })
    assert.equal(savedPlaces.items[0].personalRating, 4.7)
    assert.equal(collections.items.length, 2)
    assert.deepEqual(tags.items, [])

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
    assert.deepEqual((await writingQueries.get({ memberId, documentId: entryId })).document, {
      documentId: entryId, kind: 'entry', title: 'Two places revised', body: 'Long entry revised',
      visibility: 'public', publicationId: writingPublication, version: 2,
      placeIds: [placeTwo, placeId], createdAt: at, updatedAt: at,
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
