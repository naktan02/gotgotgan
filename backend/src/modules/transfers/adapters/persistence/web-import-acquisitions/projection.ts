import type { ImportAcquisitionV1 } from '@place/contracts/transfers'
import type { Pool, PoolClient } from 'pg'

import { WebImportAcquisitionContext } from './context.js'

export type AcquisitionRow = Readonly<{
  id: string
  command_id: string
  owner_membership_id: string
  import_source_id: string
  provider_key: 'naver'
  method: 'shared-links' | 'remote-browser'
  state: ImportAcquisitionV1['state']
  revision: string
  request_fingerprint: string
  snapshot_id: string | null
  ready_count: number
  failed_count: number
  created_at: Date
  updated_at: Date
}>

type AcquisitionItemRow = Readonly<{
  entry_id: string
  source_position: number
  state: ImportAcquisitionV1['items'][number]['state']
  source_list_id: string | null
  observed_name: string | null
  item_count: number | null
  duplicate_of_entry_id: string | null
  failure_code: NonNullable<ImportAcquisitionV1['items'][number]['failure']>['code'] | null
  failure_retryable: boolean | null
}>

export class WebImportAcquisitionProjection {
  constructor(private readonly context: WebImportAcquisitionContext) {}

  get(memberId: string, acquisitionId: string): Promise<ImportAcquisitionV1 | undefined> {
    return this.getWith(this.context.pool, memberId, acquisitionId)
  }

  async getWith(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    memberId: string,
    acquisitionId: string,
  ): Promise<ImportAcquisitionV1 | undefined> {
    const header = (await queryable.query<AcquisitionRow>(
      `SELECT * FROM transfers.web_import_acquisitions
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [acquisitionId, memberId],
    )).rows[0]
    if (header === undefined) return undefined
    const items = (await queryable.query<AcquisitionItemRow>(
      `SELECT entry_id, source_position, state, source_list_id, observed_name,
              item_count, duplicate_of_entry_id, failure_code, failure_retryable
       FROM transfers.web_import_acquisition_items
       WHERE acquisition_id = $1::uuid ORDER BY source_position, entry_id`,
      [acquisitionId],
    )).rows
    const projectedItems: ImportAcquisitionV1['items'] = items.map((item) => ({
      entryId: item.entry_id,
      position: item.source_position,
      state: item.state,
      ...(item.source_list_id === null ? {} : { sourceListId: item.source_list_id }),
      ...(item.observed_name === null ? {} : { name: item.observed_name }),
      ...(item.item_count === null ? {} : { itemCount: item.item_count }),
      ...(item.duplicate_of_entry_id === null ? {} : {
        duplicateOfEntryId: item.duplicate_of_entry_id,
      }),
      ...(item.failure_code === null || item.failure_retryable === null ? {} : {
        failure: { code: item.failure_code, retryable: item.failure_retryable },
      }),
    }))
    const processed = projectedItems.filter(
      (item) => item.state !== 'pending' && item.state !== 'fetching',
    ).length
    return {
      schemaVersion: 'import-acquisition.v1',
      acquisitionId: header.id,
      acquisitionRevision: header.revision,
      importSourceId: header.import_source_id,
      providerKey: header.provider_key,
      method: header.method,
      state: header.state,
      items: projectedItems,
      progress: {
        total: projectedItems.length,
        processed,
        ready: header.ready_count,
        failed: header.failed_count,
      },
      ...(header.snapshot_id === null ? {} : {
        snapshot: {
          snapshotId: header.snapshot_id,
          snapshotVersion: await this.snapshotVersion(queryable, header.snapshot_id, memberId),
        },
      }),
      ...(header.method === 'remote-browser' ? {
        interaction: { state: 'integration-gated' as const },
      } : {}),
      createdAt: header.created_at.toISOString(),
      updatedAt: header.updated_at.toISOString(),
    }
  }

  private async snapshotVersion(
    queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    snapshotId: string,
    memberId: string,
  ): Promise<string> {
    const row = (await queryable.query<{ content_digest: string }>(
      `SELECT content_digest FROM transfers.source_snapshots
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [snapshotId, memberId],
    )).rows[0]
    if (row === undefined) throw new Error('acquisition snapshot is unavailable')
    const body = Buffer.from(JSON.stringify({
      v: 1, id: snapshotId, revision: row.content_digest,
    }), 'utf8').toString('base64url')
    return `source-snapshot-revision.v1.${body}`
  }
}
