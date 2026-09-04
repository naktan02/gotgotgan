import {
  deterministicOperationId,
  readOpaqueRevision,
} from '../../../application/identity.js'
import type {
  ImportPlanCommandRequestV2,
  ImportPlanV2,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

export class ImportPlanApproval {
  constructor(
    private readonly context: ProviderTransferContext,
    private readonly projection: ImportPlanProjection,
  ) {}

  async approve(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-approve'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const operationId = deterministicOperationId('import-materialization', command.planId)
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
      const plan = (await client.query<{
        revision: string
        state: string
        unresolved: number
        provider_key: ProviderKey
        connection_id: string
        label: string
        item_count: number
      }>(
        `SELECT plan.revision::text, plan.state, snapshot.provider_key, snapshot.connection_id,
                connection.label,
                (SELECT count(*)::int FROM transfers.import_plan_items AS item
                 WHERE item.plan_id = plan.id AND item.preview_status = 'unresolved') AS unresolved,
                (SELECT count(*)::int FROM transfers.import_plan_items AS item
                 WHERE item.plan_id = plan.id AND item.preview_status <> 'skipped') AS item_count
         FROM transfers.import_plans AS plan
         JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
         JOIN transfers.provider_connections AS connection ON connection.id = snapshot.connection_id
         WHERE plan.id = $1::uuid AND plan.owner_membership_id = $2::uuid
         FOR UPDATE OF plan`,
        [command.planId, memberId],
      )).rows[0]
      if (plan === undefined) return this.reject(
        client, command, memberId, kind, fingerprint, 'not-found', at,
      )
      if (plan.state !== 'draft' ||
        readOpaqueRevision('import-plan', command.expectedPlanRevision,
          command.planId) !== plan.revision) {
        return this.reject(
          client, command, memberId, kind, fingerprint, 'revision-conflict', at,
        )
      }
      if (plan.unresolved > 0) return this.reject(
        client, command, memberId, kind, fingerprint, 'not-approvable', at,
      )
      await client.query(
        `INSERT INTO transfers.operations (
           id, owner_membership_id, kind, provider_key, connection_id, account_label,
           resource_kind, resource_id, stage, state, total_count, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'import-materialization',$3,$4::uuid,$5,
           'import-plan',$6::uuid,'queued-for-materialization','queued',$7,
           $8::timestamptz,$8::timestamptz)`,
        [operationId, memberId, plan.provider_key, plan.connection_id,
          plan.label, command.planId, plan.item_count, at],
      )
      await client.query(
        `UPDATE transfers.import_plans SET state = 'applying', approval_command_id = $3::uuid,
           operation_id = $4::uuid, revision = revision + 1,
           updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [command.planId, memberId, command.commandId, operationId, at],
      )
      await client.query(
        `INSERT INTO transfers.operation_items (
           operation_id, item_key, canonical_place_id, status, source_position, updated_at
         ) SELECT $1::uuid,
                  encode(sha256(convert_to(jsonb_build_array(
                    item.source_list_id::text, item.source_item_id::text)::text, 'UTF8')), 'hex'),
                  item.resolved_place_id, 'pending',
                  row_number() OVER (ORDER BY list.source_position, snapshot_item.source_position,
                    item.source_list_id, item.source_item_id) - 1, $3::timestamptz
           FROM transfers.import_plan_items AS item
           JOIN transfers.import_plans AS plan ON plan.id = item.plan_id
           JOIN transfers.source_snapshot_lists AS list
             ON list.snapshot_id = plan.snapshot_id AND list.source_list_id = item.source_list_id
           JOIN transfers.source_snapshot_items AS snapshot_item
             ON snapshot_item.snapshot_id = plan.snapshot_id
            AND snapshot_item.source_list_id = item.source_list_id
            AND snapshot_item.source_item_id = item.source_item_id
          WHERE item.plan_id = $2::uuid AND item.preview_status <> 'skipped'`,
        [operationId, command.planId, at],
      )
      const value = await this.projection.getWithClient(client, memberId, command.planId)
      if (value === undefined) throw new Error('queued import projection unavailable')
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
    client: import('pg').PoolClient,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'approve' }>,
    memberId: string,
    kind: string,
    fingerprint: string,
    code: Parameters<ProviderTransferContext['rejectInTransaction']>[1]['code'],
    at: string,
  ) {
    return this.context.rejectInTransaction<ImportPlanV2>(client, {
      commandId: command.commandId, memberId, kind, fingerprint, code, at,
    })
  }
}
