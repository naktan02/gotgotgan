import { Pool } from 'pg'

import {
  EncryptedFileCaptureArtifactStore,
  PostgresPlaceImports,
  sweepExpiredImportCaptures,
  type CaptureArtifactReplayStore,
  type ImportCaptureRetentionStore,
} from '../../modules/ingestion/index.js'
import type { CaptureSweepConfig } from './config.js'

export type { CaptureSweepConfig } from './config.js'

type CaptureSweepResources = Readonly<{
  retention: ImportCaptureRetentionStore
  artifacts: CaptureArtifactReplayStore
  close: () => Promise<void>
}>

type CaptureSweepRuntimeDependencies = Readonly<{
  now?: () => Date
  createResources?: (config: CaptureSweepConfig) => Promise<CaptureSweepResources>
}>

async function createProductionResources(
  config: CaptureSweepConfig,
  now: () => Date,
): Promise<CaptureSweepResources> {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  try {
    await pool.query('SELECT 1')
    return {
      retention: new PostgresPlaceImports(pool),
      artifacts: new EncryptedFileCaptureArtifactStore({ ...config.artifacts, now }),
      close: () => pool.end(),
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

export async function runCaptureExpirySweep(
  config: CaptureSweepConfig,
  dependencies: CaptureSweepRuntimeDependencies = {},
) {
  const currentTime = (dependencies.now ?? (() => new Date()))()
  const now = () => currentTime
  const resources = await (
    dependencies.createResources?.(config) ?? createProductionResources(config, now)
  )
  try {
    return await sweepExpiredImportCaptures({
      expiredAt: currentTime.toISOString(),
      limit: config.limit,
      retention: resources.retention,
      artifacts: resources.artifacts,
    })
  } finally {
    await resources.close()
  }
}
