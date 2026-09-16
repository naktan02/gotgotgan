import type { Pool } from 'pg'

import type { WebImportAcquisitionStore } from '../../application/ports/web-import-acquisition.js'
import { WebImportAcquisitionCommands } from './web-import-acquisitions/commands.js'
import { WebImportAcquisitionContext } from './web-import-acquisitions/context.js'
import { WebImportAcquisitionProjection } from './web-import-acquisitions/projection.js'
import { WebImportAcquisitionQueue } from './web-import-acquisitions/queue.js'
import { WebImportAcquisitionStarter } from './web-import-acquisitions/start.js'

/** PostgreSQL adapter for the durable one-shot acquisition interface. */
export class PostgresWebImportAcquisitions implements WebImportAcquisitionStore {
  private readonly projection: WebImportAcquisitionProjection
  private readonly starter: WebImportAcquisitionStarter
  private readonly commands: WebImportAcquisitionCommands
  private readonly queue: WebImportAcquisitionQueue

  constructor(pool: Pool, now: () => Date = () => new Date()) {
    const context = new WebImportAcquisitionContext(pool, now)
    this.projection = new WebImportAcquisitionProjection(context)
    this.starter = new WebImportAcquisitionStarter(context, this.projection)
    this.commands = new WebImportAcquisitionCommands(context, this.projection)
    this.queue = new WebImportAcquisitionQueue(context)
  }

  reserve(...input: Parameters<WebImportAcquisitionStore['reserve']>) {
    return this.starter.reserve(...input)
  }

  activate(...input: Parameters<WebImportAcquisitionStore['activate']>) {
    return this.starter.activate(...input)
  }

  get(...input: Parameters<WebImportAcquisitionStore['get']>) {
    return this.projection.get(...input)
  }

  cancel(...input: Parameters<WebImportAcquisitionStore['cancel']>) {
    return this.commands.cancel(...input)
  }

  claim(...input: Parameters<WebImportAcquisitionStore['claim']>) {
    return this.queue.claim(...input)
  }

  recordInspectionSnapshot(
    ...input: Parameters<WebImportAcquisitionStore['recordInspectionSnapshot']>
  ) {
    return this.queue.recordInspectionSnapshot(...input)
  }

  complete(...input: Parameters<WebImportAcquisitionStore['complete']>) {
    return this.queue.complete(...input)
  }

  expire(...input: Parameters<WebImportAcquisitionStore['expire']>) {
    return this.queue.expire(...input)
  }

  pendingArtifactCleanup(...input: Parameters<WebImportAcquisitionStore['pendingArtifactCleanup']>) {
    return this.queue.pendingArtifactCleanup(...input)
  }

  markArtifactDeleted(...input: Parameters<WebImportAcquisitionStore['markArtifactDeleted']>) {
    return this.queue.markArtifactDeleted(...input)
  }
}
