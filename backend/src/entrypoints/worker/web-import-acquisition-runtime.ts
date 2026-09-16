import { Pool } from 'pg'

import { EncryptedFileCaptureArtifactStore } from '../../modules/ingestion/index.js'
import {
  NaverSharedListSource,
  PinnedNaverHttpsClient,
} from '../../modules/providers/index.js'
import {
  createWebImportAcquisitionWorker,
  PostgresWebImportAcquisitions,
  type SharedLinkImportSource,
  type WebImportAcquisitionStore,
  type WebImportArtifactStore,
} from '../../modules/transfers/index.js'
import type { WebImportAcquisitionConfig } from './config.js'

export type { WebImportAcquisitionConfig } from './config.js'

type Resources = Readonly<{
  store: WebImportAcquisitionStore
  artifacts: WebImportArtifactStore
  source: SharedLinkImportSource
  close: () => Promise<void>
}>

type Dependencies = Readonly<{
  now?: () => Date
  createResources?: (config: WebImportAcquisitionConfig, now: () => Date) => Promise<Resources>
}>

async function createProductionResources(
  config: WebImportAcquisitionConfig,
  now: () => Date,
): Promise<Resources> {
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
      store: new PostgresWebImportAcquisitions(pool, now),
      artifacts: new EncryptedFileCaptureArtifactStore({ ...config.artifacts, now }),
      source: new NaverSharedListSource(new PinnedNaverHttpsClient()),
      close: () => pool.end(),
    }
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function runWebImportAcquisitions(
  config: WebImportAcquisitionConfig,
  input: Readonly<{ continuous: boolean; signal?: AbortSignal }>,
  dependencies: Dependencies = {},
) {
  const now = dependencies.now ?? (() => new Date())
  const resources = await (
    dependencies.createResources?.(config, now) ?? createProductionResources(config, now)
  )
  const signal = input.signal ?? new AbortController().signal
  const worker = createWebImportAcquisitionWorker({
    workerId: config.workerId,
    leaseMilliseconds: config.leaseMilliseconds,
    store: resources.store,
    artifacts: resources.artifacts,
    source: resources.source,
    now,
  })
  let processed = 0
  try {
    while (!signal.aborted && (input.continuous || processed < config.maximumJobs)) {
      const result = await worker.runOne(signal)
      if (result.status !== 'idle') {
        processed += 1
        continue
      }
      if (!input.continuous) return { processed, stopped: 'idle' as const }
      await wait(config.idleMilliseconds, signal)
    }
    return { processed, stopped: signal.aborted ? 'aborted' as const : 'limit' as const }
  } finally {
    await resources.close()
  }
}
