import type { Pool, PoolClient } from 'pg'

import { deterministicOperationId } from '../identity.js'
import type {
  VerifiedSourcePlaceMaterialization,
  VerifiedSourcePlaceMaterializerPort,
} from './verified-source-place-materializer.js'
import {
  PostgresImportLease,
  type ClaimedImportOperation,
} from './postgres-import-lease.js'

type PolicyCreateRow = Readonly<{
  item_key: string | null
  checkpoint_place_id: string | null
  provider_key: string
  source_list_id: string
  source_item_id: string
  provider_place_id: string | null
  match_reason: string | null
  source_observation_id: string | null
  place_candidate_id: string | null
  detail_normalized_at: Date | null
  evidence_snapshot_id: string | null
  acquisition_kind: NonNullable<VerifiedSourcePlaceMaterialization['snapshotEvidence']>['acquisitionKind'] | null
  parser_version: string | null
  content_digest: string
  observed_at: Date
  captured_at: Date
  observed_name: string
  observed_address: string | null
  observed_category: string | null
  latitude: number | null
  longitude: number | null
}>

export class PostgresSourcePlaceResolution {
  constructor(
    private readonly pool: Pool,
    private readonly materializer: VerifiedSourcePlaceMaterializerPort,
    private readonly lease: PostgresImportLease,
  ) {}

  async resolveMapping(
    operation: ClaimedImportOperation,
    sourceListId: string,
  ): Promise<'ready' | 'cancelled'> {
    const rows = await this.policyCreateRows(operation, sourceListId)
    for (const row of rows) {
      const snapshotEvidence = row.evidence_snapshot_id === null ? undefined :
        this.snapshotEvidence(row)
      if (row.item_key === null || row.provider_place_id === null ||
        row.match_reason !== 'missing-identity' || (snapshotEvidence === undefined && (
          row.source_observation_id === null || row.place_candidate_id === null ||
          row.detail_normalized_at === null))) {
        throw new Error('import-invariant-violated')
      }
      if (row.checkpoint_place_id !== null) continue
      const itemKey = row.item_key
      const providerPlaceId = row.provider_place_id
      const sourceObservationId = row.source_observation_id ?? deterministicOperationId(
        'transfer-snapshot-observation', row.evidence_snapshot_id!, row.source_list_id, row.source_item_id,
      )
      const placeCandidateId = row.place_candidate_id ?? deterministicOperationId(
        'transfer-snapshot-candidate', row.evidence_snapshot_id!, row.source_list_id, row.source_item_id,
      )
      const evidenceAt = row.detail_normalized_at ?? row.captured_at
      const resolved = await this.lease.withHeartbeat(operation, () => this.materializer.materialize({
        decisionId: deterministicOperationId(
          'transfer-policy-create-decision', operation.id, row.source_list_id, row.source_item_id,
        ),
        proposedPlaceId: deterministicOperationId(
          'transfer-policy-create-place', operation.id, row.source_list_id, row.source_item_id,
        ),
        providerKey: row.provider_key,
        providerPlaceId,
        sourceObservationId,
        placeCandidateId,
        occurredAt: new Date(Math.max(
          operation.created_at.getTime(), evidenceAt.getTime(),
        )).toISOString(),
        ...(snapshotEvidence === undefined ? {} : { snapshotEvidence }),
      }))
      if (await this.checkpoint(operation, itemKey, resolved.placeId) === 'cancelled') {
        return 'cancelled'
      }
    }
    return 'ready'
  }

  private async policyCreateRows(
    operation: ClaimedImportOperation,
    sourceListId: string,
  ): Promise<readonly PolicyCreateRow[]> {
    const result = await this.pool.query<PolicyCreateRow>(
      `SELECT operation_item.item_key,
              operation_item.canonical_place_id AS checkpoint_place_id,
              snapshot.provider_key,
              item.source_list_id, item.source_item_id, snapshot_item.provider_place_id,
              snapshot_item.match_reason,
              detail.source_observation_id, detail.place_candidate_id,
              detail.normalized_at AS detail_normalized_at,
              item.evidence_snapshot_id, snapshot.acquisition_kind, snapshot.parser_version,
              snapshot.content_digest, snapshot.observed_at, snapshot.captured_at,
              snapshot_item.observed_name, snapshot_item.observed_address,
              snapshot_item.observed_category,
              ST_Y(snapshot_item.observed_location) AS latitude,
              ST_X(snapshot_item.observed_location) AS longitude
       FROM transfers.import_plan_items AS item
       JOIN transfers.import_plans AS plan ON plan.id = item.plan_id
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       JOIN transfers.source_snapshot_items AS snapshot_item
         ON snapshot_item.snapshot_id = plan.snapshot_id
        AND snapshot_item.source_list_id = item.source_list_id
        AND snapshot_item.source_item_id = item.source_item_id
       LEFT JOIN transfers.operation_items AS operation_item
         ON operation_item.operation_id = $3::uuid
        AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
          item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex')
       LEFT JOIN ingestion.provider_place_detail_observations AS detail
         ON detail.provider_key = snapshot.provider_key
        AND detail.provider_place_id = snapshot_item.provider_place_id
        AND detail.source_observation_id = item.evidence_source_observation_id
        AND detail.place_candidate_id = item.evidence_place_candidate_id
       WHERE item.plan_id = $1::uuid AND item.source_list_id = $2
         AND item.decision_kind = 'policy-create'
       ORDER BY snapshot_item.source_position, item.source_item_id`,
      [operation.resource_id, sourceListId, operation.id],
    )
    return result.rows
  }

  private snapshotEvidence(row: PolicyCreateRow) {
    if (row.acquisition_kind === null || row.parser_version === null ||
      row.observed_name.trim().length === 0) throw new Error('import-invariant-violated')
    return {
      acquisitionKind: row.acquisition_kind,
      parserVersion: row.parser_version,
      payloadChecksum: row.content_digest,
      observedAt: row.observed_at.toISOString(),
      acquiredAt: row.captured_at.toISOString(),
      name: row.observed_name,
      address: row.observed_address,
      categoryLabel: row.observed_category,
      location: row.latitude === null || row.longitude === null
        ? null : { latitude: row.latitude, longitude: row.longitude },
    }
  }

  private async checkpoint(
    operation: ClaimedImportOperation,
    itemKey: string,
    placeId: string,
  ): Promise<'ready' | 'cancelled'> {
    const at = this.lease.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const cancelled = await this.lease.lock(client, operation)
      const updated = await client.query(
        `UPDATE transfers.operation_items SET canonical_place_id = $3::uuid,
           updated_at = $4::timestamptz
         WHERE operation_id = $1::uuid AND item_key = $2
           AND status = 'pending' AND canonical_place_id IS NULL`,
        [operation.id, itemKey, placeId, at],
      )
      if (updated.rowCount !== 1) await this.assertCheckpoint(client, operation.id, itemKey, placeId)
      if (cancelled) await this.lease.finishCancellation(client, operation, at)
      await client.query('COMMIT')
      return cancelled ? 'cancelled' : 'ready'
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async assertCheckpoint(
    client: Pick<PoolClient, 'query'>,
    operationId: string,
    itemKey: string,
    placeId: string,
  ) {
    const row = (await client.query<{ canonical_place_id: string | null; status: string }>(
      `SELECT canonical_place_id, status FROM transfers.operation_items
       WHERE operation_id = $1::uuid AND item_key = $2`,
      [operationId, itemKey],
    )).rows[0]
    if (row?.canonical_place_id !== placeId || row.status !== 'pending') {
      throw new Error('import-invariant-violated')
    }
  }
}
