import {
  deterministicOperationId,
  readOpaqueRevision,
} from '../../../application/identity.js'
import type {
  ImportPlanCommandRequestV2,
  ImportPlanCommandRequestV3,
  ImportPlanCommandRequestV4,
  ImportPlanV2,
  ImportPlanV3,
  ImportPlanV4,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

type ImportPlan = ImportPlanV2 | ImportPlanV3 | ImportPlanV4
type ImportPlanCommand = ImportPlanCommandRequestV2 | ImportPlanCommandRequestV3 |
  ImportPlanCommandRequestV4
type ImportPlanContractMajor = 2 | 3 | 4

export class ImportPlanApproval {
  constructor(
    private readonly context: ProviderTransferContext,
    private readonly projection: ImportPlanProjection,
  ) {}

  approveV2(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    return this.approve(memberId, command, 2) as Promise<TransferCommandResult<ImportPlanV2>>
  }

  approveV3(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV3, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<ImportPlanV3>> {
    return this.approve(memberId, command, 3) as Promise<TransferCommandResult<ImportPlanV3>>
  }

  approveV4(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV4, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<ImportPlanV4>> {
    return this.approve(memberId, command, 4) as Promise<TransferCommandResult<ImportPlanV4>>
  }

  private async approve(
    memberId: string,
    command: Extract<ImportPlanCommand, { kind: 'approve' }>,
    contractMajor: ImportPlanContractMajor,
  ): Promise<TransferCommandResult<ImportPlan>> {
    const kind = contractMajor === 2 ? 'import-plan-approve'
      : `import-plan-v${contractMajor}-approve`
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const operationId = deterministicOperationId('import-materialization', command.planId)
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const prior = await this.context.prior<ImportPlan>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        async (reference, receiptClient) => reference.kind === 'import-plan'
          ? this.project(receiptClient, memberId, reference.id, contractMajor)
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
        import_source_id: string
        import_source_kind: 'verified-connection' | 'one-shot'
        connection_id: string | null
        label: string | null
        item_count: number
      }>(
        `SELECT plan.revision::text, plan.state, snapshot.provider_key,
                snapshot.import_source_id, snapshot.import_source_kind, snapshot.connection_id,
                connection.label,
                (SELECT count(*)::int FROM transfers.import_plan_items AS item
                 WHERE item.plan_id = plan.id AND item.preview_status = 'unresolved') AS unresolved,
                (SELECT count(*)::int FROM transfers.import_plan_items AS item
                 WHERE item.plan_id = plan.id AND item.preview_status <> 'skipped') AS item_count
         FROM transfers.import_plans AS plan
         JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
         LEFT JOIN transfers.provider_connections AS connection ON connection.id = snapshot.connection_id
         WHERE plan.id = $1::uuid AND plan.owner_membership_id = $2::uuid
           AND plan.contract_major = $3
         FOR UPDATE OF plan`,
        [command.planId, memberId, contractMajor],
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
           import_source_id, import_source_kind,
           resource_kind, resource_id, stage, state, total_count, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'import-materialization',$3,$4::uuid,$5,
           $6::uuid,$7,
           'import-plan',$8::uuid,'queued-for-materialization','queued',$9,
           $10::timestamptz,$10::timestamptz)`,
        [operationId, memberId, plan.provider_key, plan.connection_id,
          plan.label, plan.import_source_id, plan.import_source_kind,
          command.planId, plan.item_count, at],
      )
      await client.query(
        `UPDATE transfers.import_plans SET state = 'applying', approval_command_id = $3::uuid,
           operation_id = $4::uuid, revision = revision + 1,
           updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid
           AND contract_major = $6`,
        [command.planId, memberId, command.commandId, operationId, at, contractMajor],
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
          WHERE item.plan_id = $2::uuid AND item.preview_status <> 'skipped'
            AND plan.contract_major = $4`,
        [operationId, command.planId, at, contractMajor],
      )
      const value = await this.project(client, memberId, command.planId, contractMajor)
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
    command: Extract<ImportPlanCommand, { kind: 'approve' }>,
    memberId: string,
    kind: string,
    fingerprint: string,
    code: Parameters<ProviderTransferContext['rejectInTransaction']>[1]['code'],
    at: string,
  ) {
    return this.context.rejectInTransaction<ImportPlan>(client, {
      commandId: command.commandId, memberId, kind, fingerprint, code, at,
    })
  }

  private project(
    client: Pick<import('pg').PoolClient, 'query'>,
    memberId: string,
    planId: string,
    contractMajor: ImportPlanContractMajor,
  ): Promise<ImportPlan | undefined> {
    if (contractMajor === 2) return this.projection.getWithClientV2(client, memberId, planId)
    if (contractMajor === 3) return this.projection.getWithClientV3(client, memberId, planId)
    return this.projection.getWithClientV4(client, memberId, planId)
  }
}
