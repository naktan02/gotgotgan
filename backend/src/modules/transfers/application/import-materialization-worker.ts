import type { Pool } from 'pg'

import type { ImportedCollectionMaterializerPort } from '../domain/model.js'
import {
  ImportMaterializationLeaseLostError,
  type ImportMaterializationResult,
  type ImportLeaseOptions,
  PostgresImportLease,
} from './import-materialization/postgres-import-lease.js'
import { PostgresImportMaterializer } from './import-materialization/postgres-import-materializer.js'

/**
 * Stable worker seam. Lease/fencing and collection materialization remain private
 * implementation details so entrypoints and tests exercise the same lifecycle.
 */
export class PostgresImportMaterializationWorker {
  private readonly lease: PostgresImportLease
  private readonly materializer: PostgresImportMaterializer

  constructor(
    pool: Pool,
    materializer: ImportedCollectionMaterializerPort,
    options: ImportLeaseOptions,
  ) {
    this.lease = new PostgresImportLease(pool, options)
    this.materializer = new PostgresImportMaterializer(pool, materializer, this.lease)
  }

  async runOnce(): Promise<ImportMaterializationResult> {
    const claim = await this.lease.claim()
    if (claim === undefined) return 'idle'
    if (claim.kind === 'cancelled') return 'cancelled'
    const operation = claim.operation
    try {
      return await this.materializer.run(operation)
    } catch (error) {
      if (error instanceof ImportMaterializationLeaseLostError) return 'lease-lost'
      const retryable = !(error instanceof Error && error.message === 'import-invariant-violated')
      await this.lease.recordFailure(operation, error, retryable)
      return retryable ? 'retry-scheduled' : 'blocked'
    }
  }
}
