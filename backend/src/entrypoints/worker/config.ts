import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { loadCaptureArtifactConfig } from '../../platform/config/capture-artifacts.js'

const databaseEnvironmentSchema = z.object({
  PLACE_DATABASE_URL_FILE: z.string().min(1),
  PLACE_WORKER_DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(10),
  PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS: z.coerce
    .number().int().min(1).max(600_000),
  PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: z.coerce
    .number().int().min(1).max(60_000),
})

const environmentSchema = databaseEnvironmentSchema.extend({
  PLACE_CAPTURE_ROOT: z.string().min(1),
  PLACE_CAPTURE_KEYRING_FILE: z.string().min(1),
  PLACE_CAPTURE_MAXIMUM_BYTES: z.coerce
    .number().int().min(1).max(104_857_600),
  PLACE_CAPTURE_SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000),
})

const materializationEnvironmentSchema = databaseEnvironmentSchema.extend({
  PLACE_IMPORT_MATERIALIZATION_LEASE_MILLISECONDS: z.coerce
    .number().int().min(1_000).max(600_000).default(60_000),
  PLACE_IMPORT_MATERIALIZATION_IDLE_MILLISECONDS: z.coerce
    .number().int().min(100).max(60_000).default(1_000),
  PLACE_IMPORT_MATERIALIZATION_MAXIMUM_JOBS: z.coerce
    .number().int().min(1).max(100_000).default(10_000),
})

const providerDetailEnvironmentSchema = databaseEnvironmentSchema.extend({
  PLACE_PROVIDER_DETAIL_LEASE_MILLISECONDS: z.coerce
    .number().int().min(30_000).max(600_000).default(60_000),
  PLACE_PROVIDER_DETAIL_IDLE_MILLISECONDS: z.coerce
    .number().int().min(100).max(60_000).default(1_000),
  PLACE_PROVIDER_DETAIL_MAXIMUM_ATTEMPTS: z.coerce
    .number().int().min(1).max(10).default(3),
  PLACE_PROVIDER_DETAIL_MAXIMUM_JOBS: z.coerce
    .number().int().min(1).max(10_000).default(100),
  PLACE_PROVIDER_DETAIL_RETRY_BASE_MILLISECONDS: z.coerce
    .number().int().min(1_000).max(600_000).default(30_000),
  PLACE_PROVIDER_DETAIL_FRESHNESS_MILLISECONDS: z.coerce
    .number().int().min(60_000).max(31_536_000_000).default(604_800_000),
  PLACE_PROVIDER_DETAIL_REFRESH_BATCH_SIZE: z.coerce
    .number().int().min(1).max(1_000).default(100),
  PLACE_TRACEFORGE_NAVER_PACK_FILE: z.string().min(1),
  PLACE_TRACEFORGE_NAVER_PACK_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  PLACE_TRACEFORGE_NAVER_PACK_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/),
  PLACE_TRACEFORGE_PROFILE_ROOT: z.string().min(1),
  PLACE_TRACEFORGE_RUNNER_FILE: z.string().min(1),
  PLACE_TRACEFORGE_RUNNER_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type WorkerDatabaseConfig = Readonly<{
  connectionString: string
  maxConnections: number
  idleTimeoutMilliseconds: number
  connectionTimeoutMilliseconds: number
}>

export type CaptureSweepConfig = Readonly<{
  database: WorkerDatabaseConfig
  artifacts: Readonly<{
    root: string
    activeKeyId: string
    keys: Readonly<Record<string, Uint8Array>>
    maximumBytes: number
  }>
  limit: number
}>

export type ImportMaterializationConfig = Readonly<{
  database: WorkerDatabaseConfig
  leaseMilliseconds: number
  idleMilliseconds: number
  maximumJobs: number
}>

export type ProviderDetailConfig = Readonly<{
  database: WorkerDatabaseConfig
  idleMilliseconds: number
  leaseMilliseconds: number
  maximumAttempts: number
  maximumJobs: number
  retryBaseMilliseconds: number
  freshnessMilliseconds: number
  refreshBatchSize: number
  traceforge: Readonly<{
    naverPackFile: string
    naverPackVersion: string
    profileRoot: string
    runnerFile: string
  }>
}>

function configurationError(): Error {
  return new Error('Worker configuration is invalid')
}

async function readOneLineFile(path: string): Promise<string> {
  const content = await readFile(path, 'utf8')
  const value = content.endsWith('\n')
    ? content.slice(0, -1).replace(/\r$/, '')
    : content
  if (value === '' || value.includes('\n') || value.includes('\r')) throw configurationError()
  return value
}

function databaseConnectionString(value: string): string {
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username === '' || url.password === '' || url.hostname === '' ||
    url.pathname.length <= 1 || url.hash !== ''
  ) throw configurationError()
  return value
}

async function workerDatabaseConfig(
  values: z.infer<typeof databaseEnvironmentSchema>,
): Promise<WorkerDatabaseConfig> {
  return {
    connectionString: databaseConnectionString(
      await readOneLineFile(values.PLACE_DATABASE_URL_FILE),
    ),
    maxConnections: values.PLACE_WORKER_DATABASE_MAX_CONNECTIONS,
    idleTimeoutMilliseconds: values.PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS,
    connectionTimeoutMilliseconds:
      values.PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS,
  }
}

export async function loadCaptureSweepConfig(
  environment: NodeJS.ProcessEnv,
): Promise<CaptureSweepConfig> {
  try {
    const values = environmentSchema.parse(environment)
    const [database, artifacts] = await Promise.all([
      workerDatabaseConfig(values),
      loadCaptureArtifactConfig({
        root: values.PLACE_CAPTURE_ROOT,
        keyringFile: values.PLACE_CAPTURE_KEYRING_FILE,
        maximumBytes: values.PLACE_CAPTURE_MAXIMUM_BYTES,
      }),
    ])
    return {
      database: {
        ...database,
      },
      artifacts,
      limit: values.PLACE_CAPTURE_SWEEP_BATCH_SIZE,
    }
  } catch {
    throw configurationError()
  }
}

export async function loadImportMaterializationConfig(
  environment: NodeJS.ProcessEnv,
): Promise<ImportMaterializationConfig> {
  try {
    const values = materializationEnvironmentSchema.parse(environment)
    return {
      database: await workerDatabaseConfig(values),
      leaseMilliseconds: values.PLACE_IMPORT_MATERIALIZATION_LEASE_MILLISECONDS,
      idleMilliseconds: values.PLACE_IMPORT_MATERIALIZATION_IDLE_MILLISECONDS,
      maximumJobs: values.PLACE_IMPORT_MATERIALIZATION_MAXIMUM_JOBS,
    }
  } catch {
    throw configurationError()
  }
}

export async function loadProviderDetailConfig(
  environment: NodeJS.ProcessEnv,
): Promise<ProviderDetailConfig> {
  try {
    const values = providerDetailEnvironmentSchema.parse(environment)
    const runnerFile = absolutePath(values.PLACE_TRACEFORGE_RUNNER_FILE)
    const naverPackFile = absolutePath(values.PLACE_TRACEFORGE_NAVER_PACK_FILE)
    const profileRoot = absolutePath(values.PLACE_TRACEFORGE_PROFILE_ROOT)
    await Promise.all([
      verifySha256(runnerFile, values.PLACE_TRACEFORGE_RUNNER_SHA256),
      verifySha256(naverPackFile, values.PLACE_TRACEFORGE_NAVER_PACK_SHA256),
    ])
    return {
      database: await workerDatabaseConfig(values),
      idleMilliseconds: values.PLACE_PROVIDER_DETAIL_IDLE_MILLISECONDS,
      leaseMilliseconds: values.PLACE_PROVIDER_DETAIL_LEASE_MILLISECONDS,
      maximumAttempts: values.PLACE_PROVIDER_DETAIL_MAXIMUM_ATTEMPTS,
      maximumJobs: values.PLACE_PROVIDER_DETAIL_MAXIMUM_JOBS,
      retryBaseMilliseconds: values.PLACE_PROVIDER_DETAIL_RETRY_BASE_MILLISECONDS,
      freshnessMilliseconds: values.PLACE_PROVIDER_DETAIL_FRESHNESS_MILLISECONDS,
      refreshBatchSize: values.PLACE_PROVIDER_DETAIL_REFRESH_BATCH_SIZE,
      traceforge: {
        naverPackFile,
        naverPackVersion: values.PLACE_TRACEFORGE_NAVER_PACK_VERSION,
        profileRoot,
        runnerFile,
      },
    }
  } catch {
    throw configurationError()
  }
}

function absolutePath(value: string): string {
  if (!path.isAbsolute(value)) throw configurationError()
  return path.normalize(value)
}

async function verifySha256(file: string, expected: string): Promise<void> {
  const contents = await readFile(file)
  const actual = createHash('sha256').update(contents).digest('hex')
  if (actual !== expected) throw configurationError()
}
