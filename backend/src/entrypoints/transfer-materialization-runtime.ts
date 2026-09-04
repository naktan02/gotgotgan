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
import type { TransferMaterializationConfig } from './worker/config.js'

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
  config: TransferMaterializationConfig,
  options: Readonly<{ continuous: boolean; signal: AbortSignal }>,
): Promise<Readonly<{ processed: number; swept: number; lastResult: string }>> {
  if (options.signal.aborted) return { processed: 0, swept: 0, lastResult: 'aborted' }

  const pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    allowExitOnIdle: false,
  })
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
      if (options.signal.aborted) {
        lastResult = 'aborted'
        break
      }
      swept += await outbound.sweepExpiredReceipts(config.sweepLimit)
      if (options.signal.aborted) {
        lastResult = 'aborted'
        break
      }
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
