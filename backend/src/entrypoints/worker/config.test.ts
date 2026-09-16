import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadCaptureSweepConfig,
  loadImportMaterializationConfig,
  loadProviderDetailConfig,
  loadTransferMaterializationConfig,
} from './config.js'

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

  it('loads bounded v2 transfer materialization settings from the shared worker database secret', async () => {
    const environment = await validEnvironment({
      PLACE_TRANSFER_MATERIALIZATION_WORKER_ID: 'transfer-worker-a',
      PLACE_TRANSFER_MATERIALIZATION_LEASE_MILLISECONDS: '30000',
      PLACE_TRANSFER_MATERIALIZATION_MAXIMUM_BACKOFF_MILLISECONDS: '900000',
      PLACE_TRANSFER_MATERIALIZATION_POLL_MILLISECONDS: '750',
      PLACE_TRANSFER_MATERIALIZATION_SWEEP_LIMIT: '125',
    })
    delete environment.PLACE_CAPTURE_ROOT
    delete environment.PLACE_CAPTURE_KEYRING_FILE
    delete environment.PLACE_CAPTURE_MAXIMUM_BYTES
    delete environment.PLACE_CAPTURE_SWEEP_BATCH_SIZE

    await expect(loadTransferMaterializationConfig(environment)).resolves.toEqual({
      database: {
        connectionString: 'postgresql://place:secret@database/place',
        maxConnections: 2,
        idleTimeoutMilliseconds: 10_000,
        connectionTimeoutMilliseconds: 3_000,
      },
      workerId: 'transfer-worker-a',
      leaseMilliseconds: 30_000,
      maximumBackoffMilliseconds: 900_000,
      pollMilliseconds: 750,
      sweepLimit: 125,
    })
  })

  it('reserves a second database connection for the v2 transfer lease heartbeat', async () => {
    const environment = await validEnvironment({
      PLACE_WORKER_DATABASE_MAX_CONNECTIONS: '1',
    })

    await expect(loadTransferMaterializationConfig(environment)).rejects.toThrow(
      'Worker configuration is invalid',
    )
  })

  it('loads an exact Runner, Pack and private profile root for provider detail acquisition', async () => {
    const environment = await validEnvironment()
    const directory = temporaryDirectories.at(-1)!
    const runnerFile = join(directory, 'runner.js')
    const packFile = join(directory, 'naver-pack.json')
    await Promise.all([
      writeFile(runnerFile, 'fixture'),
      writeFile(packFile, '{}'),
    ])
    Object.assign(environment, {
      PLACE_PROVIDER_DETAIL_LEASE_MILLISECONDS: '90000',
      PLACE_PROVIDER_DETAIL_FRESHNESS_MILLISECONDS: '86400000',
      PLACE_PROVIDER_DETAIL_MAXIMUM_ATTEMPTS: '4',
      PLACE_PROVIDER_DETAIL_MAXIMUM_JOBS: '25',
      PLACE_PROVIDER_DETAIL_REFRESH_BATCH_SIZE: '50',
      PLACE_TRACEFORGE_NAVER_PACK_FILE: packFile,
      PLACE_TRACEFORGE_NAVER_PACK_SHA256: sha256('{}'),
      PLACE_TRACEFORGE_NAVER_PACK_VERSION: '0.2.0',
      PLACE_TRACEFORGE_PROFILE_ROOT: join(directory, 'profiles'),
      PLACE_TRACEFORGE_RUNNER_FILE: runnerFile,
      PLACE_TRACEFORGE_RUNNER_SHA256: sha256('fixture'),
    })

    await expect(loadProviderDetailConfig(environment)).resolves.toMatchObject({
      leaseMilliseconds: 90_000,
      freshnessMilliseconds: 86_400_000,
      maximumAttempts: 4,
      maximumJobs: 25,
      refreshBatchSize: 50,
      traceforge: {
        naverPackFile: packFile,
        naverPackVersion: '0.2.0',
        profileRoot: join(directory, 'profiles'),
        runnerFile,
      },
    })
  })

  it('rejects a provider detail artifact whose digest does not match', async () => {
    const environment = await validEnvironment()
    const directory = temporaryDirectories.at(-1)!
    const runnerFile = join(directory, 'runner.js')
    const packFile = join(directory, 'naver-pack.json')
    await Promise.all([
      writeFile(runnerFile, 'modified-runner'),
      writeFile(packFile, '{}'),
    ])
    Object.assign(environment, {
      PLACE_TRACEFORGE_NAVER_PACK_FILE: packFile,
      PLACE_TRACEFORGE_NAVER_PACK_SHA256: sha256('{}'),
      PLACE_TRACEFORGE_NAVER_PACK_VERSION: '0.2.0',
      PLACE_TRACEFORGE_PROFILE_ROOT: join(directory, 'profiles'),
      PLACE_TRACEFORGE_RUNNER_FILE: runnerFile,
      PLACE_TRACEFORGE_RUNNER_SHA256: sha256('expected-runner'),
    })

    await expect(loadProviderDetailConfig(environment)).rejects.toEqual(
      new Error('Worker configuration is invalid'),
    )
  })
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
