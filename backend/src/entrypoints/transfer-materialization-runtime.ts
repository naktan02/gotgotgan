import { randomUUID } from 'node:crypto'

import { Pool } from 'pg'

import {
  asOpaqueVersion,
  normalizeImportedCollectionMaterialization,
  PostgresImportedCollectionMaterializer,
} from '../modules/library/index.js'
import {
  PostgresImportMaterializationWorker,
  PostgresConnectorCaptures,
  PostgresOutboundExecutions,
  PostgresTransferOperations,
  type ImportedCollectionMaterializerPort,
} from '../modules/transfers/index.js'

export type TransferWorkerConfig = Readonly<{
  databaseUrl: string
  workerId: string
  leaseMilliseconds: number
  maximumBackoffMilliseconds: number
  pollMilliseconds: number
  sweepLimit: number
}>

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('Transfer worker setting must be positive')
  return parsed
}

export function loadTransferWorkerConfig(environment: NodeJS.ProcessEnv): TransferWorkerConfig {
  const databaseUrl = environment.DATABASE_URL?.trim()
  if (databaseUrl === undefined || databaseUrl === '') throw new Error('DATABASE_URL is required')
  return {
    databaseUrl,
    workerId: environment.PLACE_TRANSFER_WORKER_ID?.trim() || `transfer-worker-${randomUUID()}`,
    leaseMilliseconds: positiveInteger(environment.PLACE_TRANSFER_LEASE_MS, 30_000),
    maximumBackoffMilliseconds: positiveInteger(environment.PLACE_TRANSFER_MAXIMUM_BACKOFF_MS, 15 * 60_000),
    pollMilliseconds: positiveInteger(environment.PLACE_TRANSFER_POLL_MS, 1_000),
    sweepLimit: positiveInteger(environment.PLACE_TRANSFER_SWEEP_LIMIT, 100),
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal.removeEventListener('abort', done)
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function runTransferMaterialization(
  config: TransferWorkerConfig,
  options: Readonly<{ continuous: boolean; signal: AbortSignal }>,
): Promise<Readonly<{ processed: number; swept: number; lastResult: string }>> {
  const pool = new Pool({ connectionString: config.databaseUrl, allowExitOnIdle: false })
  try {
    const libraryMaterializer = new PostgresImportedCollectionMaterializer(pool)
    const materializer: ImportedCollectionMaterializerPort = {
      materialize: (input) => libraryMaterializer.materialize(
        normalizeImportedCollectionMaterialization({
          context: input.context,
          source: input.source,
          target: input.target.kind === 'new'
            ? input.target
            : { ...input.target, expectedVersion: asOpaqueVersion(input.target.expectedVersion) },
          ...(input.expectedBindingVersion === undefined ? {} : {
            expectedBindingVersion: asOpaqueVersion(input.expectedBindingVersion),
          }),
          items: input.items,
        }),
      ),
    }
    const worker = new PostgresImportMaterializationWorker(pool, materializer, {
      workerId: config.workerId,
      leaseMilliseconds: config.leaseMilliseconds,
      maximumBackoffMilliseconds: config.maximumBackoffMilliseconds,
    })
    const operations = new PostgresTransferOperations(pool)
    const captures = new PostgresConnectorCaptures(pool, {
      grantTtlMilliseconds: 5 * 60_000,
      maximumChunkBytes: 4 * 1_024 * 1_024,
    })
    const outbound = new PostgresOutboundExecutions(pool, operations, {
      grantTtlMilliseconds: 5 * 60_000,
      receiptTtlMilliseconds: 60 * 60_000,
      reconciliationTtlMilliseconds: 24 * 60 * 60_000,
      maximumBytes: 128 * 1_024 * 1_024,
      maximumBatches: 1_000,
    })
    let processed = 0
    let swept = 0
    let lastResult = 'idle'
    do {
      swept += await captures.sweepExpiredCaptures(config.sweepLimit)
      swept += await outbound.sweepExpiredReceipts(config.sweepLimit)
      lastResult = await worker.runOnce()
      if (lastResult !== 'idle') processed += 1
      if (!options.continuous || options.signal.aborted) break
      if (lastResult === 'idle') await wait(config.pollMilliseconds, options.signal)
    } while (!options.signal.aborted)
    return { processed, swept, lastResult }
  } finally {
    await pool.end()
  }
}
