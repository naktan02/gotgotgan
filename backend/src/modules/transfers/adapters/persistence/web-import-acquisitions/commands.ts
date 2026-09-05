import type { PoolClient } from 'pg'

import type { WebImportAcquisitionStore } from '../../../application/ports/web-import-acquisition.js'
import { WebImportAcquisitionContext } from './context.js'
import { WebImportAcquisitionProjection } from './projection.js'
import { accepted, rejected, type AcquisitionRejection } from './result.js'

type ReceiptRow = Readonly<{
  owner_membership_id: string
  command_kind: string
  command_fingerprint: string
  status: 'pending' | 'accepted' | 'rejected'
  result: Readonly<{
    acquisitionId?: string
    rejection?: Readonly<{ code?: AcquisitionRejection }>
  }>
}>

type ArtifactRow = Readonly<{
  artifact_reference: string
  artifact_deleted_at: Date | null
}>

export class WebImportAcquisitionCommands {
  constructor(
    private readonly context: WebImportAcquisitionContext,
    private readonly projection: WebImportAcquisitionProjection,
  ) {}

  async cancel(input: Parameters<WebImportAcquisitionStore['cancel']>[0]) {
    const commandKind = 'cancel-web-import-acquisition.v1'
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.web-import-command:' || $1, 0))",
        [input.command.commandId],
      )
      const prior = (await client.query<ReceiptRow>(
        `SELECT owner_membership_id, command_kind, command_fingerprint, status, result
         FROM transfers.command_receipts WHERE command_id = $1::uuid`,
        [input.command.commandId],
      )).rows[0]
      if (prior !== undefined) {
        await client.query('COMMIT')
        if (prior.owner_membership_id !== input.memberId || prior.command_kind !== commandKind ||
          prior.command_fingerprint !== input.commandFingerprint || prior.status === 'pending') {
          return { result: rejected(input.command.commandId, 'command-id-reused') }
        }
        if (prior.status === 'rejected') {
          return { result: rejected(
            input.command.commandId, prior.result.rejection?.code ?? 'command-id-reused',
          ) }
        }
        const acquisitionId = prior.result.acquisitionId
        const acquisition = acquisitionId === undefined
          ? undefined : await this.projection.get(input.memberId, acquisitionId)
        if (acquisition === undefined) throw new Error('replayed acquisition command disappeared')
        return {
          result: accepted(input.command.commandId, 'replayed', acquisition),
          ...await this.cleanupArtifact(acquisition.acquisitionId),
        }
      }
      if ((await client.query(
        'SELECT 1 FROM transfers.web_import_acquisitions WHERE command_id = $1::uuid',
        [input.command.commandId],
      )).rowCount !== 0) {
        await client.query('ROLLBACK')
        return { result: rejected(input.command.commandId, 'command-id-reused') }
      }
      const job = (await client.query<ArtifactRow & { state: string }>(
        `SELECT state, artifact_reference, artifact_deleted_at
         FROM transfers.web_import_acquisition_jobs
         WHERE acquisition_id = $1::uuid FOR UPDATE`,
        [input.command.acquisitionId],
      )).rows[0]
      await client.query(
        `SELECT id FROM transfers.web_import_acquisitions
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [input.command.acquisitionId, input.memberId],
      )
      const current = await this.projection.getWith(
        client, input.memberId, input.command.acquisitionId,
      )
      if (current === undefined) {
        return this.reject(client, input, commandKind, 'not-found')
      }
      if (current.acquisitionRevision !== input.command.expectedAcquisitionRevision) {
        return this.reject(client, input, commandKind, 'revision-conflict')
      }
      if (current.state !== 'processing' || job?.state !== 'queued') {
        return this.reject(client, input, commandKind, 'not-cancellable')
      }
      await client.query(
        `UPDATE transfers.web_import_acquisition_jobs
         SET state = 'cancelled', updated_at = $2::timestamptz, completed_at = $2::timestamptz
         WHERE acquisition_id = $1::uuid`,
        [input.command.acquisitionId, input.cancelledAt],
      )
      await client.query(
        `UPDATE transfers.web_import_acquisitions
         SET state = 'cancelled', revision = revision + 1,
             updated_at = $3::timestamptz, completed_at = $3::timestamptz
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [input.command.acquisitionId, input.memberId, input.cancelledAt],
      )
      const acquisition = await this.projection.getWith(
        client, input.memberId, input.command.acquisitionId,
      )
      if (acquisition === undefined) throw new Error('cancelled acquisition disappeared')
      await client.query(
        `INSERT INTO transfers.command_receipts (
           command_id, owner_membership_id, command_kind, command_fingerprint,
           status, result, created_at, completed_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'accepted',$5::jsonb,
           $6::timestamptz,$6::timestamptz)`,
        [input.command.commandId, input.memberId, commandKind, input.commandFingerprint,
          JSON.stringify({ acquisitionId: acquisition.acquisitionId }), input.cancelledAt],
      )
      await client.query('COMMIT')
      return {
        result: accepted(input.command.commandId, 'applied', acquisition),
        ...(job.artifact_deleted_at === null ? { artifact: {
          reference: job.artifact_reference,
          acquisitionId: input.command.acquisitionId,
          providerKey: 'naver' as const,
        } } : {}),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async reject(
    client: PoolClient,
    input: Parameters<WebImportAcquisitionStore['cancel']>[0],
    commandKind: string,
    code: Exclude<AcquisitionRejection, 'command-id-reused'>,
  ) {
    await client.query(
      `INSERT INTO transfers.command_receipts (
         command_id, owner_membership_id, command_kind, command_fingerprint,
         status, result, created_at, completed_at
       ) VALUES ($1::uuid,$2::uuid,$3,$4,'rejected',$5::jsonb,
         $6::timestamptz,$6::timestamptz)`,
      [input.command.commandId, input.memberId, commandKind, input.commandFingerprint,
        JSON.stringify({ rejection: { code } }), input.cancelledAt],
    )
    await client.query('COMMIT')
    return { result: rejected(input.command.commandId, code) }
  }

  private async cleanupArtifact(acquisitionId: string) {
    const row = (await this.context.pool.query<ArtifactRow>(
      `SELECT artifact_reference, artifact_deleted_at
       FROM transfers.web_import_acquisition_jobs WHERE acquisition_id = $1::uuid`,
      [acquisitionId],
    )).rows[0]
    return row === undefined || row.artifact_deleted_at !== null ? {} : { artifact: {
      reference: row.artifact_reference,
      acquisitionId,
      providerKey: 'naver' as const,
    } }
  }
}
