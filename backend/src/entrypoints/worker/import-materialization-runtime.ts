import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  createImportedPlaceFulfillmentWorker,
  PostgresIngestionStore,
  PostgresPlaceImports,
  type CanonicalPlaceMaterializationPort,
  type ImportedPlaceFulfillmentStore,
  type ImportedPlaceLibraryPort,
  type IngestionStore,
} from '../../modules/ingestion/index.js'
import { PostgresLibraryStore, saveImportedPlace } from '../../modules/library/index.js'
import {
  applyCanonicalResolution,
  PostgresCanonicalResolutionStore,
} from '../../modules/places/index.js'
import type { ImportMaterializationConfig } from './config.js'

export type { ImportMaterializationConfig } from './config.js'

type MaterializationResources = Readonly<{
  store: ImportedPlaceFulfillmentStore
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
  library: ImportedPlaceLibraryPort
  close: () => Promise<void>
}>

type RuntimeDependencies = Readonly<{
  now?: () => Date
  workerId?: string
  createResources?: (config: ImportMaterializationConfig) => Promise<MaterializationResources>
}>

async function createProductionResources(
  config: ImportMaterializationConfig,
): Promise<MaterializationResources> {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
  try {
    await pool.query('SELECT 1')
    const canonicalStore = new PostgresCanonicalResolutionStore(pool)
    const libraryStore = new PostgresLibraryStore(pool)
    return {
      store: new PostgresPlaceImports(pool),
      ingestionStore: new PostgresIngestionStore(pool),
      canonical: {
        resolveProviderIdentity: (identity) => canonicalStore.resolveProviderIdentity(identity),
        apply: (attempt) => applyCanonicalResolution({ ...attempt, store: canonicalStore }),
      },
      library: {
        saveImportedPlace: (input) => saveImportedPlace({ ...input, store: libraryStore }),
      },
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

export async function runImportMaterialization(
  config: ImportMaterializationConfig,
  input: Readonly<{ continuous: boolean; signal?: AbortSignal }>,
  dependencies: RuntimeDependencies = {},
) {
  const resources = await (
    dependencies.createResources?.(config) ?? createProductionResources(config)
  )
  const signal = input.signal ?? new AbortController().signal
  const worker = createImportedPlaceFulfillmentWorker({
    workerId: dependencies.workerId ?? `place-import-materialization:${randomUUID()}`,
    store: resources.store,
    ingestionStore: resources.ingestionStore,
    canonical: resources.canonical,
    library: resources.library,
    now: dependencies.now ?? (() => new Date()),
    leaseMilliseconds: config.leaseMilliseconds,
  })
  let processed = 0
  try {
    while (!signal.aborted && (input.continuous || processed < config.maximumJobs)) {
      const result = await worker.runOne()
      if (result.status !== 'idle') {
        processed += 1
        continue
      }
      if (!input.continuous) return { processed, stopped: 'idle' as const }
      await wait(config.idleMilliseconds, signal)
    }
    return {
      processed,
      stopped: signal.aborted ? 'aborted' as const : 'limit' as const,
    }
  } finally {
    await resources.close()
  }
}
