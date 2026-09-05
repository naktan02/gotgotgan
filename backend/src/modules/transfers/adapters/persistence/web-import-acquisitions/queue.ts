import type { SharedLinkInspectionResult } from '../../../domain/acquisitions.js'
import type {
  WebImportAcquisitionClaim,
  WebImportAcquisitionStore,
} from '../../../application/ports/web-import-acquisition.js'
import { transferFingerprint } from '../../../application/identity.js'
import { recordOneShotSourceSnapshot } from '../provider-transfers/one-shot-source-snapshots.js'
import { WebImportAcquisitionContext } from './context.js'

type ClaimRow = Readonly<{
  acquisition_id: string
  owner_membership_id: string
  import_source_id: string
  provider_key: 'naver'
  snapshot_id: string
  artifact_reference: string
  artifact_checksum: string
  artifact_retained_until: Date
  created_at: Date
  lease_owner: string
  lease_generation: string | number
  lease_expires_at: Date
  inspection_results: readonly SharedLinkInspectionResult[] | null
  state: 'preparing' | 'queued' | 'leased' | 'completed' | 'cancelled'
}>

type ExpectedItemRow = Readonly<{
  entry_id: string
  source_position: number
  input_digest: string
}>

type ClaimCandidateRow = Readonly<{
  acquisition_id: string
  owner_membership_id: string
}>

function itemState(result: Extract<SharedLinkInspectionResult, { status: 'failed' }>) {
  if (result.code === 'invalid-url' || result.code === 'unsupported-host' ||
    result.code === 'redirect-policy-denied') return 'invalid' as const
  if (result.code === 'provider-rate-limited') return 'rate-limited' as const
  if (result.code === 'share-not-found' || result.code === 'share-not-readable') {
    return 'unavailable' as const
  }
  return 'failed' as const
}

function sameClaim(row: ClaimRow, claim: WebImportAcquisitionClaim): boolean {
  return row.acquisition_id === claim.acquisitionId &&
    row.lease_owner === claim.lease.owner &&
    Number(row.lease_generation) === claim.lease.generation
}

export class WebImportAcquisitionQueue {
  constructor(private readonly context: WebImportAcquisitionContext) {}

  async claim(input: Parameters<WebImportAcquisitionStore['claim']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const candidate = (await client.query<ClaimCandidateRow>(
        `SELECT job.acquisition_id, acquisition.owner_membership_id
         FROM transfers.web_import_acquisition_jobs AS job
         JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = job.acquisition_id
         WHERE (
           (job.state = 'queued' AND job.available_at <= $1::timestamptz)
           OR (job.state = 'leased' AND job.lease_expires_at <= $1::timestamptz)
           OR (job.state = 'preparing' AND job.artifact_retained_until <= $1::timestamptz)
         ) AND NOT EXISTS (
           SELECT 1
           FROM transfers.web_import_acquisition_jobs AS active_job
           JOIN transfers.web_import_acquisitions AS active_acquisition
             ON active_acquisition.id = active_job.acquisition_id
           WHERE active_acquisition.owner_membership_id = acquisition.owner_membership_id
             AND active_job.state = 'leased'
             AND active_job.lease_expires_at > $1::timestamptz
         )
         ORDER BY job.available_at, job.acquisition_id
         FOR UPDATE OF job SKIP LOCKED LIMIT 1`,
        [input.claimedAt],
      )).rows[0]
      if (candidate === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.web-import-member:' || $1, 0))",
        [candidate.owner_membership_id],
      )
      const ownerAlreadyLeased = (await client.query(
        `SELECT 1
         FROM transfers.web_import_acquisition_jobs AS active_job
         JOIN transfers.web_import_acquisitions AS active_acquisition
           ON active_acquisition.id = active_job.acquisition_id
         WHERE active_acquisition.owner_membership_id = $1::uuid
           AND active_job.acquisition_id <> $2::uuid
           AND active_job.state = 'leased'
           AND active_job.lease_expires_at > $3::timestamptz
         LIMIT 1`,
        [candidate.owner_membership_id, candidate.acquisition_id, input.claimedAt],
      )).rowCount !== 0
      if (ownerAlreadyLeased) {
        await client.query('COMMIT')
        return undefined
      }
      const row = (await client.query<ClaimRow>(
        `WITH claimed AS (
           UPDATE transfers.web_import_acquisition_jobs AS job
           SET state = 'leased', lease_owner = $1,
               lease_generation = job.lease_generation + 1,
               lease_expires_at = $3::timestamptz,
               attempt_count = job.attempt_count + 1,
               updated_at = $2::timestamptz
           WHERE job.acquisition_id = $4::uuid
           RETURNING job.*
         )
         SELECT claimed.acquisition_id, acquisition.owner_membership_id,
                acquisition.import_source_id, acquisition.provider_key,
                claimed.snapshot_id, claimed.artifact_reference,
                claimed.artifact_checksum, claimed.artifact_retained_until,
                claimed.inspection_results,
                acquisition.created_at, claimed.lease_owner,
                claimed.lease_generation, claimed.lease_expires_at
         FROM claimed JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = claimed.acquisition_id`,
        [input.workerId, input.claimedAt, input.leaseUntil, candidate.acquisition_id],
      )).rows[0]
      if (row === undefined) throw new Error('web import acquisition claim disappeared')
      await client.query(
        `UPDATE transfers.web_import_acquisitions
         SET revision = revision + 1, updated_at = $2::timestamptz
         WHERE id = $1::uuid AND state = 'processing'`,
        [row.acquisition_id, input.claimedAt],
      )
      await client.query(
        `UPDATE transfers.web_import_acquisition_items
         SET state = 'fetching', updated_at = $2::timestamptz
         WHERE acquisition_id = $1::uuid AND state = 'pending'`,
        [row.acquisition_id, input.claimedAt],
      )
      await client.query('COMMIT')
      return this.projectClaim(row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async recordInspectionSnapshot(
    input: Parameters<WebImportAcquisitionStore['recordInspectionSnapshot']>[0],
  ): Promise<void> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const lease = (await client.query<ClaimRow>(
        `SELECT job.*, acquisition.owner_membership_id, acquisition.import_source_id,
                acquisition.provider_key, acquisition.created_at
         FROM transfers.web_import_acquisition_jobs AS job
         JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = job.acquisition_id
         WHERE job.acquisition_id = $1::uuid FOR UPDATE`,
        [input.claim.acquisitionId],
      )).rows[0]
      if (lease === undefined || !sameClaim(lease, input.claim) || lease.state !== 'leased' ||
        lease.lease_expires_at.getTime() <= Date.parse(input.recordedAt)) {
        throw new Error('web import acquisition lease was lost')
      }
      const expected = (await client.query<ExpectedItemRow>(
        `SELECT entry_id, source_position, input_digest
         FROM transfers.web_import_acquisition_items
         WHERE acquisition_id = $1::uuid ORDER BY source_position`,
        [input.claim.acquisitionId],
      )).rows
      this.assertResults(expected, input.results)
      this.assertSnapshot(input.claim, input.results, input.snapshot)
      if (lease.inspection_results !== null &&
        transferFingerprint(lease.inspection_results) !== transferFingerprint(input.results)) {
        throw new Error('web import acquisition inspection changed')
      }
      await client.query(
        `UPDATE transfers.web_import_acquisition_jobs
         SET inspection_results = coalesce(inspection_results,$2::jsonb),
             updated_at = greatest(updated_at,$3::timestamptz)
         WHERE acquisition_id = $1::uuid`,
        [input.claim.acquisitionId, JSON.stringify(input.results), input.recordedAt],
      )
      if (input.snapshot !== undefined) {
        await recordOneShotSourceSnapshot(client, {
          fingerprint: transferFingerprint,
          now: this.context.now,
        }, input.snapshot)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async complete(input: Parameters<WebImportAcquisitionStore['complete']>[0]): Promise<void> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const lease = (await client.query<ClaimRow>(
        `SELECT job.*, acquisition.owner_membership_id, acquisition.import_source_id,
                acquisition.provider_key, acquisition.created_at
         FROM transfers.web_import_acquisition_jobs AS job
         JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = job.acquisition_id
         WHERE job.acquisition_id = $1::uuid FOR UPDATE`,
        [input.claim.acquisitionId],
      )).rows[0]
      if (lease === undefined || !sameClaim(lease, input.claim) || lease.state !== 'leased' ||
        lease.lease_expires_at.getTime() <= Date.parse(input.completedAt)) {
        throw new Error('web import acquisition lease was lost')
      }
      const expected = (await client.query<ExpectedItemRow>(
        `SELECT entry_id, source_position, input_digest
         FROM transfers.web_import_acquisition_items
         WHERE acquisition_id = $1::uuid ORDER BY source_position`,
        [input.claim.acquisitionId],
      )).rows
      this.assertResults(expected, input.results)
      for (const result of input.results) {
        if (result.status === 'succeeded') {
          await client.query(
            `UPDATE transfers.web_import_acquisition_items
             SET state = 'ready', source_list_id = $4, observed_name = $5,
                 item_count = $6, updated_at = $7::timestamptz
             WHERE acquisition_id = $1::uuid AND entry_id = $2::uuid
               AND source_position = $3`,
            [input.claim.acquisitionId, result.entryId, result.position,
              result.list.sourceListId, result.list.observedName,
              result.list.items.length, input.completedAt],
          )
        } else if (result.status === 'duplicate') {
          await client.query(
            `UPDATE transfers.web_import_acquisition_items
             SET state = 'duplicate', duplicate_of_entry_id = $4::uuid,
                 updated_at = $5::timestamptz
             WHERE acquisition_id = $1::uuid AND entry_id = $2::uuid
               AND source_position = $3`,
            [input.claim.acquisitionId, result.entryId, result.position,
              result.duplicateOfEntryId, input.completedAt],
          )
        } else {
          await client.query(
            `UPDATE transfers.web_import_acquisition_items
             SET state = $4, failure_code = $5, failure_retryable = $6,
                 updated_at = $7::timestamptz
             WHERE acquisition_id = $1::uuid AND entry_id = $2::uuid
               AND source_position = $3`,
            [input.claim.acquisitionId, result.entryId, result.position,
              itemState(result), result.code, result.retryable, input.completedAt],
          )
        }
      }
      const readyCount = input.results.filter((result) => result.status === 'succeeded').length
      const failedCount = input.results.filter((result) => result.status === 'failed').length
      const state = readyCount === 0 ? 'failed' : failedCount === 0 ? 'ready' : 'partial'
      await client.query(
        `UPDATE transfers.web_import_acquisitions
         SET state = $2, revision = revision + 1, snapshot_id = $3::uuid,
             ready_count = $4, failed_count = $5,
             updated_at = $6::timestamptz, completed_at = $6::timestamptz
         WHERE id = $1::uuid AND state = 'processing'`,
        [input.claim.acquisitionId, state,
          readyCount === 0 ? null : input.claim.snapshotId,
          readyCount, failedCount, input.completedAt],
      )
      await client.query(
        `UPDATE transfers.web_import_acquisition_jobs
         SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
             inspection_results = NULL,
             updated_at = $2::timestamptz, completed_at = $2::timestamptz
         WHERE acquisition_id = $1::uuid`,
        [input.claim.acquisitionId, input.completedAt],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async expire(input: Parameters<WebImportAcquisitionStore['expire']>[0]): Promise<void> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const job = (await client.query<ClaimRow & { state: string }>(
        `SELECT job.*, acquisition.owner_membership_id, acquisition.import_source_id,
                acquisition.provider_key, acquisition.created_at
         FROM transfers.web_import_acquisition_jobs AS job
         JOIN transfers.web_import_acquisitions AS acquisition
           ON acquisition.id = job.acquisition_id
         WHERE job.acquisition_id = $1::uuid FOR UPDATE`,
        [input.claim.acquisitionId],
      )).rows[0]
      if (job === undefined || job.state !== 'leased' || !sameClaim(job, input.claim)) {
        throw new Error('web import acquisition lease was lost')
      }
      await client.query(
        `UPDATE transfers.web_import_acquisition_items
         SET state = 'failed', failure_code = 'session-expired', failure_retryable = false,
             updated_at = $2::timestamptz
         WHERE acquisition_id = $1::uuid AND state IN ('pending','fetching')`,
        [input.claim.acquisitionId, input.expiredAt],
      )
      const failedCount = Number((await client.query<{ count: string }>(
        `SELECT count(*) FROM transfers.web_import_acquisition_items
         WHERE acquisition_id = $1::uuid AND state = 'failed'`,
        [input.claim.acquisitionId],
      )).rows[0]!.count)
      await client.query(
        `UPDATE transfers.web_import_acquisitions
         SET state = 'expired', revision = revision + 1, failed_count = $2,
             updated_at = $3::timestamptz, completed_at = $3::timestamptz
         WHERE id = $1::uuid AND state = 'processing'`,
        [input.claim.acquisitionId, failedCount, input.expiredAt],
      )
      await client.query(
        `UPDATE transfers.web_import_acquisition_jobs
         SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL,
             inspection_results = NULL,
             updated_at = $2::timestamptz, completed_at = $2::timestamptz
         WHERE acquisition_id = $1::uuid`,
        [input.claim.acquisitionId, input.expiredAt],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async pendingArtifactCleanup(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid cleanup limit')
    return (await this.context.pool.query<{
      acquisition_id: string
      provider_key: 'naver'
      artifact_reference: string
    }>(
      `SELECT job.acquisition_id, acquisition.provider_key, job.artifact_reference
       FROM transfers.web_import_acquisition_jobs AS job
       JOIN transfers.web_import_acquisitions AS acquisition
         ON acquisition.id = job.acquisition_id
       WHERE job.state IN ('completed','cancelled') AND job.artifact_deleted_at IS NULL
       ORDER BY job.completed_at, job.acquisition_id LIMIT $1`,
      [limit],
    )).rows.map((row) => ({
      acquisitionId: row.acquisition_id,
      providerKey: row.provider_key,
      reference: row.artifact_reference,
    }))
  }

  async markArtifactDeleted(acquisitionId: string, deletedAt: string): Promise<void> {
    await this.context.pool.query(
      `UPDATE transfers.web_import_acquisition_jobs
       SET artifact_deleted_at = coalesce(artifact_deleted_at,$2::timestamptz),
           updated_at = greatest(updated_at,$2::timestamptz)
       WHERE acquisition_id = $1::uuid AND state IN ('completed','cancelled')`,
      [acquisitionId, deletedAt],
    )
  }

  private projectClaim(row: ClaimRow): WebImportAcquisitionClaim {
    return {
      acquisitionId: row.acquisition_id,
      ownerMemberId: row.owner_membership_id,
      importSourceId: row.import_source_id,
      providerKey: row.provider_key,
      snapshotId: row.snapshot_id,
      artifact: {
        artifactId: row.artifact_reference.slice('capture:'.length),
        reference: row.artifact_reference,
        checksum: row.artifact_checksum,
        retainedUntil: row.artifact_retained_until.toISOString(),
      },
      observedAt: row.created_at.toISOString(),
      ...(row.inspection_results === null ? {} : {
        inspectionResults: row.inspection_results,
      }),
      lease: {
        owner: row.lease_owner,
        generation: Number(row.lease_generation),
        expiresAt: row.lease_expires_at.toISOString(),
      },
    }
  }

  private assertResults(
    expected: readonly ExpectedItemRow[],
    results: readonly SharedLinkInspectionResult[],
  ): void {
    if (expected.length !== results.length || expected.length > 20) {
      throw new Error('web import acquisition results are incomplete')
    }
    let itemCount = 0
    const byEntry = new Map(results.map((result) => [result.entryId, result]))
    if (byEntry.size !== results.length) throw new Error('web import acquisition results are duplicated')
    for (const item of expected) {
      const result = byEntry.get(item.entry_id)
      if (result === undefined || result.position !== item.source_position ||
        result.inputUrlDigest !== item.input_digest) {
        throw new Error('web import acquisition result binding is invalid')
      }
      if (result.status === 'succeeded') {
        if (result.list.items.length > 500) throw new Error('web import list exceeds limit')
        itemCount += result.list.items.length
      }
    }
    if (itemCount > 10_000) throw new Error('web import acquisition exceeds item limit')
  }

  private assertSnapshot(
    claim: WebImportAcquisitionClaim,
    results: readonly SharedLinkInspectionResult[],
    snapshot: Parameters<WebImportAcquisitionStore['recordInspectionSnapshot']>[0]['snapshot'],
  ): void {
    const lists = results.filter((result) => result.status === 'succeeded').map((result) => ({
      ...result.list,
      items: result.list.items.map((item) => ({
        ...item,
        match: { status: 'unresolved' as const, reason: 'missing-identity' as const },
      })),
    }))
    if ((lists.length === 0) !== (snapshot === undefined)) {
      throw new Error('web import acquisition snapshot presence is invalid')
    }
    if (snapshot !== undefined && (snapshot.snapshotId !== claim.snapshotId ||
      snapshot.ownerMemberId !== claim.ownerMemberId ||
      snapshot.providerKey !== claim.providerKey ||
      snapshot.source.kind !== 'one-shot' ||
      snapshot.source.importSourceId !== claim.importSourceId ||
      snapshot.source.acquisitionMethod !== 'shared-link' ||
      snapshot.source.authorizationBasis !== 'link-possession' ||
      snapshot.source.accountAssurance !== 'unverified' ||
      transferFingerprint(snapshot.lists) !== transferFingerprint(lists))) {
      throw new Error('web import acquisition snapshot binding is invalid')
    }
  }
}
