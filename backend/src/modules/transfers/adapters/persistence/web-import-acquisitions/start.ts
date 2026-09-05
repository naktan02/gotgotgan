import type { WebImportAcquisitionStore } from '../../../application/ports/web-import-acquisition.js'
import { WebImportAcquisitionContext } from './context.js'
import { WebImportAcquisitionProjection, type AcquisitionRow } from './projection.js'
import { accepted, rejected } from './result.js'

export class WebImportAcquisitionStarter {
  constructor(
    private readonly context: WebImportAcquisitionContext,
    private readonly projection: WebImportAcquisitionProjection,
  ) {}

  async reserve(input: Parameters<WebImportAcquisitionStore['reserve']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.web-import-command:' || $1, 0))",
        [input.command.commandId],
      )
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.web-import-member:' || $1, 0))",
        [input.memberId],
      )
      const byCommand = (await client.query<AcquisitionRow>(
        `SELECT * FROM transfers.web_import_acquisitions WHERE command_id = $1::uuid`,
        [input.command.commandId],
      )).rows[0]
      if (byCommand !== undefined) {
        if (byCommand.owner_membership_id !== input.memberId ||
          byCommand.request_fingerprint !== input.requestFingerprint) {
          await client.query('COMMIT')
          return { status: 'complete' as const,
            result: rejected(input.command.commandId, 'command-id-reused') }
        }
        const preparing = input.command.kind === 'shared-links'
          ? (await client.query<{
              artifact_reference: string
              artifact_checksum: string
              artifact_retained_until: Date
            }>(
              `SELECT artifact_reference, artifact_checksum, artifact_retained_until
               FROM transfers.web_import_acquisition_jobs
               WHERE acquisition_id = $1::uuid AND state = 'preparing'`,
              [byCommand.id],
            )).rows[0]
          : undefined
        if (preparing !== undefined) {
          if (input.artifact === undefined ||
            preparing.artifact_checksum !== input.artifact.checksum) {
            throw new Error('prepared acquisition artifact binding changed')
          }
          await client.query('COMMIT')
          return { status: 'reserved' as const, artifact: {
            artifactId: preparing.artifact_reference.slice('capture:'.length),
            reference: preparing.artifact_reference,
            checksum: preparing.artifact_checksum,
            retainedUntil: preparing.artifact_retained_until.toISOString(),
          } }
        }
        await client.query('COMMIT')
        const acquisition = await this.projection.get(input.memberId, byCommand.id)
        if (acquisition === undefined) throw new Error('replayed acquisition disappeared')
        return { status: 'complete' as const,
          result: accepted(input.command.commandId, 'replayed', acquisition) }
      }
      if ((await client.query(
        'SELECT 1 FROM transfers.command_receipts WHERE command_id = $1::uuid',
        [input.command.commandId],
      )).rowCount !== 0 || (await client.query(
        'SELECT 1 FROM transfers.web_import_acquisitions WHERE id = $1::uuid',
        [input.command.acquisitionId],
      )).rowCount !== 0) {
        await client.query('ROLLBACK')
        return { status: 'complete' as const,
          result: rejected(input.command.commandId, 'command-id-reused') }
      }

      const remote = input.command.kind === 'remote-browser'
      const activeJobs = remote ? 0 : (await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM transfers.web_import_acquisition_jobs AS job
         JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = job.acquisition_id
         WHERE acquisition.owner_membership_id = $1::uuid
           AND job.state IN ('preparing','queued','leased')`,
        [input.memberId],
      )).rows[0]!.count
      if (activeJobs >= 3) {
        await client.query('COMMIT')
        return { status: 'complete' as const,
          result: rejected(input.command.commandId, 'limit-exceeded') }
      }
      if (!remote && (input.artifact === undefined ||
        input.inputDigests.length !== input.command.links.length)) {
        throw new Error('shared-link acquisition artifact is unavailable')
      }
      await client.query(
        `INSERT INTO transfers.import_sources (
           id, owner_membership_id, provider_key, source_kind,
           acquisition_method, authorization_basis, created_at
         ) VALUES ($1::uuid,$2::uuid,$3,'one-shot',$4,$5,$6::timestamptz)`,
        [input.command.importSourceId, input.memberId, input.command.providerKey,
          remote ? 'remote-browser' : 'shared-link',
          remote ? 'interactive-provider-session' : 'link-possession', input.startedAt],
      )
      await client.query(
        `INSERT INTO transfers.web_import_acquisitions (
           id, command_id, owner_membership_id, import_source_id, provider_key,
           method, state, revision, request_fingerprint, snapshot_id,
           ready_count, failed_count, created_at, updated_at, completed_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,1,$8,NULL,0,0,
           $9::timestamptz,$9::timestamptz,$10::timestamptz)`,
        [input.command.acquisitionId, input.command.commandId, input.memberId,
          input.command.importSourceId, input.command.providerKey,
          remote ? 'remote-browser' : 'shared-links', remote ? 'failed' : 'processing',
          input.requestFingerprint, input.startedAt, remote ? input.startedAt : null],
      )
      if (!remote) {
        for (const [index, link] of input.command.links.entries()) {
          await client.query(
            `INSERT INTO transfers.web_import_acquisition_items (
               acquisition_id, entry_id, source_position, input_digest, state, updated_at
             ) VALUES ($1::uuid,$2::uuid,$3,$4,'pending',$5::timestamptz)`,
            [input.command.acquisitionId, link.entryId, link.position,
              input.inputDigests[index], input.startedAt],
          )
        }
        await client.query(
          `INSERT INTO transfers.web_import_acquisition_jobs (
             acquisition_id, snapshot_id, artifact_reference, artifact_checksum,
             artifact_retained_until, state, available_at, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::timestamptz,'preparing',
             $6::timestamptz,$6::timestamptz,$6::timestamptz)`,
          [input.command.acquisitionId, input.command.snapshotId, input.artifact!.reference,
            input.artifact!.checksum, input.artifact!.retainedUntil, input.startedAt],
        )
      }
      const acquisition = await this.projection.getWith(
        client, input.memberId, input.command.acquisitionId,
      )
      if (acquisition === undefined) throw new Error('started acquisition disappeared')
      await client.query('COMMIT')
      return remote
        ? { status: 'complete' as const,
            result: accepted(input.command.commandId, 'applied', acquisition) }
        : { status: 'reserved' as const, artifact: input.artifact! }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async activate(input: Parameters<WebImportAcquisitionStore['activate']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const job = (await client.query<{
        state: 'preparing' | 'queued' | 'leased' | 'completed' | 'cancelled'
      }>(
        `SELECT state FROM transfers.web_import_acquisition_jobs
         WHERE acquisition_id = $1::uuid FOR UPDATE`,
        [input.acquisitionId],
      )).rows[0]
      if (job === undefined) throw new Error('prepared acquisition is unavailable')
      const acquisitionBinding = await client.query(
        `SELECT id FROM transfers.web_import_acquisitions
         WHERE id = $1::uuid AND command_id = $2::uuid
           AND owner_membership_id = $3::uuid FOR UPDATE`,
        [input.acquisitionId, input.commandId, input.memberId],
      )
      if (acquisitionBinding.rowCount !== 1) throw new Error('prepared acquisition is unavailable')
      let artifactRequired = job.state !== 'completed' && job.state !== 'cancelled'
      if (job.state === 'preparing') {
        const updated = await client.query(
          `UPDATE transfers.web_import_acquisition_jobs
           SET state = 'queued', available_at = $2::timestamptz, updated_at = $2::timestamptz
           WHERE acquisition_id = $1::uuid AND state = 'preparing'`,
          [input.acquisitionId, input.activatedAt],
        )
        if (updated.rowCount !== 1) throw new Error('prepared acquisition activation failed')
      } else if (!artifactRequired) {
        await client.query(
          `UPDATE transfers.web_import_acquisition_jobs
           SET artifact_deleted_at = NULL,
               updated_at = greatest(updated_at,$2::timestamptz)
           WHERE acquisition_id = $1::uuid AND state IN ('completed','cancelled')`,
          [input.acquisitionId, input.activatedAt],
        )
      }
      const acquisition = await this.projection.getWith(client, input.memberId, input.acquisitionId)
      if (acquisition === undefined) throw new Error('activated acquisition disappeared')
      await client.query('COMMIT')
      return {
        result: accepted(
          input.commandId, job.state === 'preparing' ? 'applied' : 'replayed', acquisition,
        ),
        artifactRequired,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
