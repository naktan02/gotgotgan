import type { Pool, PoolClient } from 'pg'

import type { ImportedCollectionMaterializerPort } from '../../domain/model.js'
import type { VerifiedSourcePlaceMaterializerPort } from './verified-source-place-materializer.js'
import {
  ImportMaterializationLeaseLostError,
  PostgresImportLease,
  type ClaimedImportOperation,
} from './postgres-import-lease.js'
import { PostgresSourcePlaceResolution } from './postgres-source-place-resolution.js'

type MappingRow = Readonly<{
  source_list_id: string
  observed_name: string
  source_position: number
  provider_key: string
  import_source_id: string
  import_source_kind: 'verified-connection' | 'one-shot'
  connection_id: string | null
  target_kind: 'new' | 'existing'
  target_collection_id: string
  target_name: string | null
  expected_collection_version: string | null
  expected_binding_version: string | null
  materialization_operation_id: string
  materialization_state: 'pending' | 'applied'
  collection_version: string | null
}>

export class PostgresImportMaterializer {
  private readonly sourcePlaces: PostgresSourcePlaceResolution

  constructor(
    private readonly pool: Pool,
    private readonly materializer: ImportedCollectionMaterializerPort,
    placeMaterializer: VerifiedSourcePlaceMaterializerPort,
    private readonly lease: PostgresImportLease,
  ) {
    this.sourcePlaces = new PostgresSourcePlaceResolution(pool, placeMaterializer, lease)
  }

  async run(operation: ClaimedImportOperation) {
    const mappings = await this.pool.query<MappingRow>(
      `SELECT mapping.source_list_id, list.observed_name, list.source_position,
              snapshot.provider_key, snapshot.import_source_id, snapshot.import_source_kind,
              snapshot.connection_id, mapping.target_kind,
              mapping.target_collection_id, mapping.target_name,
              mapping.expected_collection_version, mapping.expected_binding_version,
              mapping.materialization_operation_id, mapping.materialization_state,
              mapping.collection_version
       FROM transfers.import_plan_mappings AS mapping
       JOIN transfers.import_plans AS plan ON plan.id = mapping.plan_id
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       JOIN transfers.source_snapshot_lists AS list
         ON list.snapshot_id = plan.snapshot_id AND list.source_list_id = mapping.source_list_id
       WHERE mapping.plan_id = $1::uuid ORDER BY list.source_position, list.source_list_id`,
      [operation.resource_id],
    )
    const versions = new Map<string, string>()
    for (const mapping of mappings.rows) {
      const leaseState = await this.lease.state(operation)
      if (leaseState === 'lost') throw new ImportMaterializationLeaseLostError()
      if (leaseState === 'cancel-requested') return await this.lease.acknowledgeCancel(operation)
      if (mapping.materialization_state === 'applied') {
        if (mapping.collection_version === null) throw new Error('import-invariant-violated')
        versions.set(mapping.target_collection_id, mapping.collection_version)
        continue
      }
      if (await this.sourcePlaces.resolveMapping(
        operation, mapping.source_list_id,
      ) === 'cancelled') return 'cancelled' as const
      const items = await this.pool.query<{
        source_item_id: string
        provider_place_id: string
        resolved_place_id: string | null
        source_position: number
      }>(
        `SELECT item.source_item_id, snapshot_item.provider_place_id,
                coalesce(item.resolved_place_id, operation_item.canonical_place_id)
                  AS resolved_place_id,
                snapshot_item.source_position
         FROM transfers.import_plan_items AS item
         JOIN transfers.import_plans AS plan ON plan.id = item.plan_id
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = plan.snapshot_id
          AND snapshot_item.source_list_id = item.source_list_id
          AND snapshot_item.source_item_id = item.source_item_id
         JOIN transfers.operation_items AS operation_item
           ON operation_item.operation_id = $3::uuid
          AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
            item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex')
         WHERE item.plan_id = $1::uuid AND item.source_list_id = $2
           AND item.preview_status IN ('add','already-present')
           AND snapshot_item.provider_place_id IS NOT NULL
         ORDER BY snapshot_item.source_position, item.source_item_id`,
        [operation.resource_id, mapping.source_list_id, operation.id],
      )
      if (items.rows.some((item) => item.resolved_place_id === null)) {
        throw new Error('import-invariant-violated')
      }
      const target: Parameters<ImportedCollectionMaterializerPort['materialize']>[0]['target'] =
        mapping.target_kind === 'new'
          ? { kind: 'new', collectionId: mapping.target_collection_id, name: mapping.target_name! }
          : { kind: 'existing', collectionId: mapping.target_collection_id,
              expectedVersion: versions.get(mapping.target_collection_id) ??
                mapping.expected_collection_version! }
      const materialization: Parameters<ImportedCollectionMaterializerPort['materialize']>[0] = {
        context: {
          operationId: mapping.materialization_operation_id,
          memberId: operation.owner_membership_id,
          occurredAt: operation.created_at.toISOString(),
        },
        source: {
          providerKey: mapping.provider_key,
          importSourceId: mapping.import_source_id,
          importSourceKind: mapping.import_source_kind,
          connectionId: mapping.connection_id,
          sourceListId: mapping.source_list_id,
          sourcePosition: mapping.source_position,
          observedName: mapping.observed_name,
        },
        target,
        ...(mapping.expected_binding_version === null ? {}
          : { expectedBindingVersion: mapping.expected_binding_version }),
        items: items.rows.map((item) => ({
          sourceItemId: item.source_item_id,
          providerPlaceId: item.provider_place_id,
          placeId: item.resolved_place_id!,
          sourcePosition: item.source_position,
        })),
      }
      const result = await this.lease.withHeartbeat(
        operation,
        () => this.materializer.materialize(materialization),
      )
      if (result.status === 'rejected') {
        return await this.block(operation, mapping, result.rejection.code)
      }
      versions.set(mapping.target_collection_id, result.value.version)
      const at = this.lease.now().toISOString()
      const client = await this.pool.connect()
      try {
        await client.query('BEGIN')
        const cancelled = await this.lease.lock(client, operation)
        await client.query(
          `UPDATE transfers.import_plan_mappings SET materialization_state = 'applied',
             collection_version = $3, rejection_code = NULL
           WHERE plan_id = $1::uuid AND source_list_id = $2 AND materialization_state = 'pending'`,
          [operation.resource_id, mapping.source_list_id, result.value.version],
        )
        await client.query(
          `UPDATE transfers.operation_items AS operation_item
           SET status = 'applied', updated_at = $3::timestamptz
           FROM transfers.import_plan_items AS plan_item
           WHERE operation_item.operation_id = $1::uuid
             AND plan_item.plan_id = $4::uuid AND plan_item.source_list_id = $2
             AND operation_item.item_key = encode(sha256(convert_to(jsonb_build_array(
               plan_item.source_list_id::text, plan_item.source_item_id::text)::text, 'UTF8')), 'hex')`,
          [operation.id, mapping.source_list_id, at, operation.resource_id],
        )
        await this.refreshProgress(client, operation.id, at)
        if (cancelled) await this.lease.finishCancellation(client, operation, at)
        await client.query('COMMIT')
        if (cancelled) return 'cancelled' as const
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally { client.release() }
    }
    return await this.complete(operation)
  }

  private async complete(operation: ClaimedImportOperation) {
    const at = this.lease.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const cancelled = await this.lease.lock(client, operation)
      if (cancelled) {
        await this.lease.finishCancellation(client, operation, at)
        await client.query('COMMIT')
        return 'cancelled' as const
      }
      await client.query(
        `UPDATE transfers.import_plans SET state = 'completed', blocked_reason = NULL,
           revision = revision + 1, updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [operation.resource_id, at],
      )
      const result = await client.query(
        `UPDATE transfers.operations SET state = 'completed', stage = 'library-completed',
           processed_count = total_count, applied_count = total_count, failed_count = 0,
           revision = revision + 1, lease_owner = NULL, lease_expires_at = NULL,
           updated_at = $2::timestamptz, completed_at = $2::timestamptz
         WHERE id = $1::uuid AND lease_owner = $3
           AND lease_generation = $4::bigint AND state = 'running'`,
        [operation.id, at, this.lease.workerId, operation.lease_generation],
      )
      if (result.rowCount !== 1) throw new ImportMaterializationLeaseLostError()
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
    return 'completed' as const
  }

  private async block(operation: ClaimedImportOperation, mapping: MappingRow, code: string) {
    const at = this.lease.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const cancelled = await this.lease.lock(client, operation)
      if (cancelled) {
        await this.lease.finishCancellation(client, operation, at)
        await client.query('COMMIT')
        return 'cancelled' as const
      }
      await client.query(
        `UPDATE transfers.import_plan_mappings SET materialization_state = 'rejected',
           rejection_code = $3 WHERE plan_id = $1::uuid AND source_list_id = $2`,
        [operation.resource_id, mapping.source_list_id, code],
      )
      await client.query(
        `UPDATE transfers.import_plans SET state = 'blocked', blocked_reason = 'materialization-rejected',
           revision = revision + 1, updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [operation.resource_id, at],
      )
      const result = await client.query(
        `UPDATE transfers.operations SET state = 'partial-failure', revision = revision + 1,
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = $2,
           last_error_retryable = true, updated_at = $3::timestamptz
         WHERE id = $1::uuid AND lease_owner = $4
           AND lease_generation = $5::bigint AND state = 'running'`,
        [operation.id, code.slice(0, 120), at, this.lease.workerId,
          operation.lease_generation],
      )
      if (result.rowCount !== 1) throw new ImportMaterializationLeaseLostError()
      await client.query('COMMIT')
      return 'blocked' as const
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async refreshProgress(client: Pick<PoolClient, 'query'>, id: string, at: string) {
    await client.query(
      `UPDATE transfers.operations AS operation SET
         processed_count = summary.processed, applied_count = summary.applied,
         failed_count = summary.failed, outcome_unknown_count = summary.unknown,
         revision = revision + 1, updated_at = $2::timestamptz
       FROM (SELECT count(*) FILTER (WHERE status <> 'pending')::int AS processed,
                    count(*) FILTER (WHERE status IN ('applied','already-present'))::int AS applied,
                    count(*) FILTER (WHERE status = 'failed')::int AS failed,
                    count(*) FILTER (WHERE status = 'outcome-unknown')::int AS unknown
             FROM transfers.operation_items WHERE operation_id = $1::uuid) AS summary
       WHERE operation.id = $1::uuid`, [id, at],
    )
  }
}
