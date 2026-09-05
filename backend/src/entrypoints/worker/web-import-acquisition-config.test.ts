import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadWebImportAcquisitionConfig } from './config.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('web import acquisition worker configuration', () => {
  it('loads bounded lease and the shared protected artifact keyring', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'place-web-import-config-'))
    directories.push(directory)
    const database = join(directory, 'database-url')
    const keyring = join(directory, 'capture-keyring')
    await Promise.all([
      writeFile(database, 'postgresql://place:secret@database/place\n'),
      writeFile(keyring, JSON.stringify({
        schemaVersion: 'place-capture-keyring.v1',
        activeKeyId: 'web-import-test',
        keys: [{
          id: 'web-import-test', material: Buffer.alloc(32, 5).toString('base64url'),
        }],
      })),
    ])

    const environment = {
      PLACE_DATABASE_URL_FILE: database,
      PLACE_WORKER_DATABASE_MAX_CONNECTIONS: '2',
      PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '10000',
      PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '3000',
      PLACE_CAPTURE_ROOT: join(directory, 'captures'),
      PLACE_CAPTURE_KEYRING_FILE: keyring,
      PLACE_CAPTURE_MAXIMUM_BYTES: '1000000',
      PLACE_WEB_IMPORT_ACQUISITION_WORKER_ID: 'web-worker-a',
      PLACE_WEB_IMPORT_ACQUISITION_LEASE_MILLISECONDS: '600000',
      PLACE_WEB_IMPORT_ACQUISITION_IDLE_MILLISECONDS: '750',
      PLACE_WEB_IMPORT_ACQUISITION_MAXIMUM_JOBS: '25',
    }
    await expect(loadWebImportAcquisitionConfig(environment)).resolves.toMatchObject({
      workerId: 'web-worker-a', leaseMilliseconds: 600_000,
      idleMilliseconds: 750, maximumJobs: 25,
      artifacts: { activeKeyId: 'web-import-test', maximumBytes: 1_000_000 },
    })
    await expect(loadWebImportAcquisitionConfig({
      ...environment,
      PLACE_WEB_IMPORT_ACQUISITION_LEASE_MILLISECONDS: '149999',
    })).rejects.toThrow()
  })
})
