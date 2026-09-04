import {
  deterministicOperationId,
  readOpaqueRevision,
} from '../../../application/identity.js'
import type {
  ImportPlanCommandRequestV2,
  ImportPlanV2,
  SourceSnapshotDetailV2,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import { ProviderTransferContext } from './provider-transfer-context.js'
import { ProviderSourceSnapshots } from './source-snapshots.js'

export class ImportPlanDrafts {
  constructor(
    private readonly context: ProviderTransferContext,
    private readonly snapshots: ProviderSourceSnapshots,
    private readonly projection: ImportPlanProjection,
  ) {}

  async create(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'create' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-create'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const snapshot = await this.snapshots.get(memberId, command.snapshotId)
    const targetIds = command.mappings.map((mapping) => mapping.target.collectionId)
    if (snapshot === undefined) {
      return this.reject(command.commandId, memberId, kind, fingerprint, 'not-found', at)
    }
    if (snapshot.snapshotVersion !== command.expectedSnapshotVersion) {
      return this.reject(command.commandId, memberId, kind, fingerprint, 'snapshot-changed', at)
    }
    if (new Set(command.mappings.map((mapping) => mapping.sourceListId)).size !==
      command.mappings.length) {
      return this.reject(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
    }
    for (const targetId of new Set(targetIds)) {
      const sameTarget = command.mappings.filter(
        (mapping) => mapping.target.collectionId === targetId,
      )
      if (sameTarget.length > 1 && sameTarget.some((mapping) => mapping.target.kind === 'new')) {
        return this.reject(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
    }
    const prepared: Array<{
      sourceList: SourceSnapshotDetailV2['lists'][number]
      target: typeof command.mappings[number]['target']
      existingPlaceIds: ReadonlySet<string>
      expectedBindingVersion: string | null
    }> = []
    for (const mapping of command.mappings) {
      const sourceList = snapshot.lists.find(
        (list) => list.sourceListId === mapping.sourceListId,
      )
      if (sourceList === undefined) {
        return this.reject(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      let existingPlaceIds: ReadonlySet<string> = new Set()
      const binding = await this.context.collections.readImportBinding({
        memberId,
        providerKey: snapshot.providerKey,
        connectionId: snapshot.connectionId,
        sourceListId: mapping.sourceListId,
      })
      if (binding !== undefined && binding.collectionId !== mapping.target.collectionId) {
        return this.reject(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      const observed = await this.context.collections.read({
        memberId,
        collectionId: mapping.target.collectionId,
      })
      if (mapping.target.kind === 'existing') {
        if (observed === undefined) {
          return this.reject(command.commandId, memberId, kind, fingerprint, 'not-found', at)
        }
        if (observed.collectionVersion !== mapping.target.expectedCollectionRevision) {
          return this.reject(
            command.commandId, memberId, kind, fingerprint, 'collection-changed', at,
          )
        }
        existingPlaceIds = new Set(observed.items.map((item) => item.placeId))
      } else if (observed !== undefined) {
        return this.reject(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      prepared.push({
        sourceList,
        target: mapping.target,
        existingPlaceIds,
        expectedBindingVersion: binding?.bindingVersion ?? null,
      })
    }
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const prior = await this.context.prior<ImportPlanV2>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        async (reference, receiptClient) => reference.kind === 'import-plan'
          ? this.projection.getWithClient(receiptClient, memberId, reference.id)
          : undefined,
      )
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      await client.query(
        `INSERT INTO transfers.import_plans (
           id, owner_membership_id, snapshot_id, snapshot_digest, state, revision,
           blocked_reason, approval_command_id, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'draft',1,NULL,NULL,$5::timestamptz,$5::timestamptz)`,
        [command.planId, memberId, command.snapshotId,
          readOpaqueRevision('source-snapshot', snapshot.snapshotVersion, snapshot.snapshotId), at],
      )
      for (const entry of prepared) {
        await client.query(
          `INSERT INTO transfers.import_plan_source_lists (plan_id, snapshot_id, source_list_id)
           VALUES ($1::uuid,$2::uuid,$3)`,
          [command.planId, command.snapshotId, entry.sourceList.sourceListId],
        )
        const operationId = deterministicOperationId(
          'import-plan', command.planId, entry.sourceList.sourceListId,
        )
        await client.query(
          `INSERT INTO transfers.import_plan_mappings (
             plan_id, source_list_id, target_kind, target_collection_id, target_name,
             expected_collection_version, expected_binding_version,
             materialization_state, materialization_operation_id,
             collection_version, rejection_code
           ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,'pending',$8::uuid,NULL,NULL)`,
          [command.planId, entry.sourceList.sourceListId, entry.target.kind,
            entry.target.collectionId, entry.target.kind === 'new' ? entry.target.name : null,
            entry.target.kind === 'existing'
              ? entry.target.expectedCollectionRevision : null,
            entry.expectedBindingVersion, operationId],
        )
        for (const item of entry.sourceList.items) {
          const resolved = item.match.status === 'matched' && item.providerPlaceId !== null
            ? item.match.placeId
            : null
          const status = resolved === null
            ? 'unresolved'
            : entry.existingPlaceIds.has(resolved) ? 'already-present' : 'add'
          await client.query(
            `INSERT INTO transfers.import_plan_items (
               plan_id, source_list_id, source_item_id, resolved_place_id,
               preview_status, decision_kind
             ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6)`,
            [command.planId, entry.sourceList.sourceListId, item.sourceItemId, resolved,
              status, resolved === null ? 'none' : 'snapshot-match'],
          )
        }
      }
      const value = await this.projection.getWithClient(client, memberId, command.planId)
      if (value === undefined) throw new Error('import plan projection unavailable')
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
        reference: {
          kind: 'import-plan', id: value.planId, acceptedRevision: value.planRevision,
        },
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async decide(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'decide-item' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-decide-item'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const prior = await this.context.prior<ImportPlanV2>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        async (reference, receiptClient) => reference.kind === 'import-plan'
          ? this.projection.getWithClient(receiptClient, memberId, reference.id)
          : undefined,
      )
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const plan = (await client.query<{ revision: string; state: string }>(
        `SELECT revision::text, state FROM transfers.import_plans
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [command.planId, memberId],
      )).rows[0]
      if (plan === undefined) return this.rejectInTransaction(
        client, command.commandId, memberId, kind, fingerprint, 'not-found', at,
      )
      if (plan.state !== 'draft' ||
        readOpaqueRevision('import-plan', command.expectedPlanRevision,
          command.planId) !== plan.revision) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'revision-conflict', at,
        )
      }
      const item = (await client.query<{
        provider_place_id: string | null
        target_kind: 'new' | 'existing'
        target_collection_id: string
        expected_collection_version: string | null
      }>(
        `SELECT snapshot_item.provider_place_id, mapping.target_kind,
                mapping.target_collection_id, mapping.expected_collection_version
         FROM transfers.import_plan_items AS planned
         JOIN transfers.import_plans AS plan ON plan.id = planned.plan_id
         JOIN transfers.import_plan_mappings AS mapping
           ON mapping.plan_id = planned.plan_id AND mapping.source_list_id = planned.source_list_id
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = plan.snapshot_id
          AND snapshot_item.source_list_id = planned.source_list_id
          AND snapshot_item.source_item_id = planned.source_item_id
         WHERE planned.plan_id = $1::uuid AND planned.source_list_id = $2
           AND planned.source_item_id = $3`,
        [command.planId, command.sourceListId, command.sourceItemId],
      )).rows[0]
      if (item === undefined) return this.rejectInTransaction(
        client, command.commandId, memberId, kind, fingerprint, 'not-found', at,
      )
      let resolvedPlaceId: string | null = null
      let status: 'add' | 'already-present' | 'skipped'
      if (command.decision.kind === 'skip') {
        status = 'skipped'
      } else {
        if (item.provider_place_id === null) return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'invalid-selection', at,
        )
        const place = await client.query(
          'SELECT 1 FROM places.canonical_places WHERE id = $1::uuid',
          [command.decision.placeId],
        )
        if (place.rows[0] === undefined) return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'not-found', at,
        )
        resolvedPlaceId = command.decision.placeId
        status = 'add'
        if (item.target_kind === 'existing') {
          const observed = await this.context.collections.read({
            memberId,
            collectionId: item.target_collection_id,
          })
          if (observed === undefined ||
            observed.collectionVersion !== item.expected_collection_version) {
            return this.rejectInTransaction(
              client, command.commandId, memberId, kind, fingerprint, 'collection-changed', at,
            )
          }
          if (observed.items.some((candidate) => candidate.placeId === resolvedPlaceId)) {
            status = 'already-present'
          }
        }
      }
      await client.query(
        `UPDATE transfers.import_plan_items
         SET resolved_place_id = $4::uuid, preview_status = $5, decision_kind = $6
         WHERE plan_id = $1::uuid AND source_list_id = $2 AND source_item_id = $3`,
        [command.planId, command.sourceListId, command.sourceItemId,
          resolvedPlaceId, status, command.decision.kind],
      )
      await client.query(
        `UPDATE transfers.import_plans
         SET revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $3::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [command.planId, memberId, at],
      )
      const value = await this.projection.getWithClient(client, memberId, command.planId)
      if (value === undefined) throw new Error('import plan projection unavailable')
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
        reference: {
          kind: 'import-plan', id: value.planId, acceptedRevision: value.planRevision,
        },
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private reject(
    commandId: string,
    memberId: string,
    kind: string,
    fingerprint: string,
    code: Parameters<ProviderTransferContext['rejectStandalone']>[0]['code'],
    at: string,
  ) {
    return this.context.rejectStandalone<ImportPlanV2>({
      commandId, memberId, kind, fingerprint, code, at,
      resolveReference: async (reference, client) => reference.kind === 'import-plan'
        ? this.projection.getWithClient(client, memberId, reference.id)
        : undefined,
    })
  }

  private rejectInTransaction(
    client: import('pg').PoolClient,
    commandId: string,
    memberId: string,
    kind: string,
    fingerprint: string,
    code: Parameters<ProviderTransferContext['rejectInTransaction']>[1]['code'],
    at: string,
  ) {
    return this.context.rejectInTransaction<ImportPlanV2>(client, {
      commandId, memberId, kind, fingerprint, code, at,
    })
  }
}
