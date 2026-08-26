import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadCaptureSweepConfig, loadImportMaterializationConfig } from './config.js'

const temporaryDirectories: string[] = []

async function validEnvironment(overrides: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), 'place-worker-config-'))
  temporaryDirectories.push(directory)
  const databaseUrlFile = join(directory, 'database-url')
  const keyringFile = join(directory, 'capture-keyring.json')
  await Promise.all([
    writeFile(databaseUrlFile, 'postgresql://place:secret@database/place\n', { mode: 0o600 }),
    writeFile(keyringFile, JSON.stringify({
      schemaVersion: 'place-capture-keyring.v1',
      activeKeyId: 'primary-2026',
      keys: [{
        id: 'primary-2026',
        material: Buffer.alloc(32, 7).toString('base64url'),
      }],
    }), { mode: 0o600 }),
  ])
  return {
    PLACE_DATABASE_URL_FILE: databaseUrlFile,
    PLACE_WORKER_DATABASE_MAX_CONNECTIONS: '2',
    PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS: '10000',
    PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: '3000',
    PLACE_CAPTURE_ROOT: join(directory, 'captures'),
    PLACE_CAPTURE_KEYRING_FILE: keyringFile,
    PLACE_CAPTURE_MAXIMUM_BYTES: '10485760',
    PLACE_CAPTURE_SWEEP_BATCH_SIZE: '250',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('worker configuration', () => {
  it('loads bounded database, artifact and sweep settings from protected files', async () => {
    const config = await loadCaptureSweepConfig(await validEnvironment())

    expect(config.database).toEqual({
      connectionString: 'postgresql://place:secret@database/place',
      maxConnections: 2,
      idleTimeoutMilliseconds: 10_000,
      connectionTimeoutMilliseconds: 3_000,
    })
    expect(config.artifacts.activeKeyId).toBe('primary-2026')
    expect(config.artifacts.keys['primary-2026']).toEqual(new Uint8Array(32).fill(7))
    expect(config.artifacts.maximumBytes).toBe(10_485_760)
    expect(config.limit).toBe(250)
  })

  it('rejects a relative capture root without exposing protected values', async () => {
    const environment = await validEnvironment({ PLACE_CAPTURE_ROOT: 'relative/captures' })

    await expect(loadCaptureSweepConfig(environment)).rejects.toEqual(
      new Error('Worker configuration is invalid'),
    )
  })

  it('rejects duplicate, malformed or inactive keyring keys', async () => {
    const environment = await validEnvironment()
    await writeFile(environment.PLACE_CAPTURE_KEYRING_FILE!, JSON.stringify({
      schemaVersion: 'place-capture-keyring.v1',
      activeKeyId: 'missing',
      keys: [
        { id: 'duplicate', material: Buffer.alloc(32, 1).toString('base64url') },
        { id: 'duplicate', material: Buffer.alloc(32, 2).toString('base64url') },
      ],
    }))

    await expect(loadCaptureSweepConfig(environment)).rejects.toEqual(
      new Error('Worker configuration is invalid'),
    )
  })

  it('rejects an unbounded sweep batch', async () => {
    const environment = await validEnvironment({ PLACE_CAPTURE_SWEEP_BATCH_SIZE: '1001' })

    await expect(loadCaptureSweepConfig(environment)).rejects.toEqual(
      new Error('Worker configuration is invalid'),
    )
  })

  it('loads bounded import materialization settings without capture credentials', async () => {
    const environment = await validEnvironment({
      PLACE_IMPORT_MATERIALIZATION_LEASE_MILLISECONDS: '45000',
      PLACE_IMPORT_MATERIALIZATION_IDLE_MILLISECONDS: '750',
      PLACE_IMPORT_MATERIALIZATION_MAXIMUM_JOBS: '5000',
    })
    delete environment.PLACE_CAPTURE_ROOT
    delete environment.PLACE_CAPTURE_KEYRING_FILE
    delete environment.PLACE_CAPTURE_MAXIMUM_BYTES
    delete environment.PLACE_CAPTURE_SWEEP_BATCH_SIZE

    await expect(loadImportMaterializationConfig(environment)).resolves.toMatchObject({
      leaseMilliseconds: 45_000,
      idleMilliseconds: 750,
      maximumJobs: 5_000,
      database: { maxConnections: 2 },
    })
  })
})
