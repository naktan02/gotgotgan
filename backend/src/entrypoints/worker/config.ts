import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { loadCaptureArtifactConfig } from '../../platform/config/capture-artifacts.js'

const environmentSchema = z.object({
  PLACE_DATABASE_URL_FILE: z.string().min(1),
  PLACE_WORKER_DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(10),
  PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS: z.coerce
    .number().int().min(1).max(600_000),
  PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS: z.coerce
    .number().int().min(1).max(60_000),
  PLACE_CAPTURE_ROOT: z.string().min(1),
  PLACE_CAPTURE_KEYRING_FILE: z.string().min(1),
  PLACE_CAPTURE_MAXIMUM_BYTES: z.coerce
    .number().int().min(1).max(104_857_600),
  PLACE_CAPTURE_SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000),
})

export type CaptureSweepConfig = Readonly<{
  database: Readonly<{
    connectionString: string
    maxConnections: number
    idleTimeoutMilliseconds: number
    connectionTimeoutMilliseconds: number
  }>
  artifacts: Readonly<{
    root: string
    activeKeyId: string
    keys: Readonly<Record<string, Uint8Array>>
    maximumBytes: number
  }>
  limit: number
}>

function configurationError(): Error {
  return new Error('Capture sweep configuration is invalid')
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

export async function loadCaptureSweepConfig(
  environment: NodeJS.ProcessEnv,
): Promise<CaptureSweepConfig> {
  try {
    const values = environmentSchema.parse(environment)
    const [databaseUrl, artifacts] = await Promise.all([
      readOneLineFile(values.PLACE_DATABASE_URL_FILE),
      loadCaptureArtifactConfig({
        root: values.PLACE_CAPTURE_ROOT,
        keyringFile: values.PLACE_CAPTURE_KEYRING_FILE,
        maximumBytes: values.PLACE_CAPTURE_MAXIMUM_BYTES,
      }),
    ])
    return {
      database: {
        connectionString: databaseConnectionString(databaseUrl),
        maxConnections: values.PLACE_WORKER_DATABASE_MAX_CONNECTIONS,
        idleTimeoutMilliseconds: values.PLACE_WORKER_DATABASE_IDLE_TIMEOUT_MILLISECONDS,
        connectionTimeoutMilliseconds:
          values.PLACE_WORKER_DATABASE_CONNECTION_TIMEOUT_MILLISECONDS,
      },
      artifacts,
      limit: values.PLACE_CAPTURE_SWEEP_BATCH_SIZE,
    }
  } catch {
    throw configurationError()
  }
}
