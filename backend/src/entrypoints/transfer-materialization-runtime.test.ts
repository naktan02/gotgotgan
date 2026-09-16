import { describe, expect, it } from 'vitest'

import { runTransferMaterialization } from './transfer-materialization-runtime.js'

describe('transfer materialization runtime', () => {
  it('does not open the database or claim work after shutdown was requested', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(runTransferMaterialization({
      database: {
        connectionString: 'not-a-database-url',
        maxConnections: 2,
        idleTimeoutMilliseconds: 10_000,
        connectionTimeoutMilliseconds: 3_000,
      },
      workerId: 'transfer-worker-test',
      leaseMilliseconds: 30_000,
      maximumBackoffMilliseconds: 900_000,
      pollMilliseconds: 1_000,
      sweepLimit: 100,
    }, {
      continuous: true,
      signal: controller.signal,
    })).resolves.toEqual({ processed: 0, swept: 0, lastResult: 'aborted' })
  })
})
