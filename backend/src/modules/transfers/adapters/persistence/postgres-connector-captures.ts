import type { Pool } from 'pg'

import type { ConnectorTransferReceiver } from '../../domain/operations.js'
import {
  ConnectorCaptureContext,
  type ConnectorCaptureOptions,
} from './connector-captures/capture-context.js'
import { ConnectorCaptureExpirySweeper } from './connector-captures/capture-expiry-sweeper.js'
import { ConnectorCaptureSession } from './connector-captures/capture-session.js'
import { ConnectorImportGrantIssuer } from './connector-captures/import-grant-issuer.js'

/**
 * Stable connector-capture adapter seam. Grant issuance, chunk/session handling,
 * and expiry transitions are private roles sharing one transaction context.
 */
export class PostgresConnectorCaptures implements ConnectorTransferReceiver {
  private readonly grants: ConnectorImportGrantIssuer
  private readonly session: ConnectorCaptureSession
  private readonly expiry: ConnectorCaptureExpirySweeper

  constructor(pool: Pool, options: ConnectorCaptureOptions) {
    const context = new ConnectorCaptureContext(pool, options)
    this.grants = new ConnectorImportGrantIssuer(context)
    this.session = new ConnectorCaptureSession(context)
    this.expiry = new ConnectorCaptureExpirySweeper(context)
  }

  issueImportGrant(
    ...input: Parameters<ConnectorTransferReceiver['issueImportGrant']>
  ): ReturnType<ConnectorTransferReceiver['issueImportGrant']> {
    return this.grants.issue(...input)
  }

  recordChunk(
    ...input: Parameters<ConnectorTransferReceiver['recordChunk']>
  ): ReturnType<ConnectorTransferReceiver['recordChunk']> {
    return this.session.recordChunk(...input)
  }

  status(
    ...input: Parameters<ConnectorTransferReceiver['status']>
  ): ReturnType<ConnectorTransferReceiver['status']> {
    return this.session.status(...input)
  }

  complete(
    ...input: Parameters<ConnectorTransferReceiver['complete']>
  ): ReturnType<ConnectorTransferReceiver['complete']> {
    return this.session.complete(...input)
  }

  sweepExpiredCaptures(limit: number): Promise<number> {
    return this.expiry.sweep(limit)
  }
}
