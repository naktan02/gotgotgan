import { readOpaqueRevision } from '../../../application/identity.js'
import type {
  ImportPlanCommandRequestV3,
  ImportPlanV3,
  TransferCommandResult,
} from '../../../domain/model.js'
import { ImportPlanProjection } from './import-plan-projection.js'
import { ProviderTransferContext } from './provider-transfer-context.js'

type RefreshEvidenceCommand = Extract<
  ImportPlanCommandRequestV3,
  { kind: 'refresh-evidence' }
>

/**
 * Pins available detail or minimum snapshot evidence for undecided V3 draft items.
 * User decisions and already-pinned policy evidence are outside this module's write set.
 */
export class ImportPlanEvidenceRefresh {
  constructor(
    private readonly context: ProviderTransferContext,
    private readonly projection: ImportPlanProjection,
  ) {}

  async refreshV3(
    memberId: string,
    command: RefreshEvidenceCommand,
  ): Promise<TransferCommandResult<ImportPlanV3>> {
    const kind = 'import-plan-v3-refresh-evidence'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const prior = await this.context.prior<ImportPlanV3>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        async (reference, receiptClient) => reference.kind === 'import-plan'
          ? this.projection.getWithClientV3(receiptClient, memberId, reference.id)
          : undefined,
      )
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const plan = (await client.query<{ revision: string; state: string }>(
        `SELECT revision::text, state
         FROM transfers.import_plans
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid
           AND contract_major = 3
         FOR UPDATE`,
        [command.planId, memberId],
      )).rows[0]
      if (plan === undefined) {
        return this.reject(client, command, memberId, kind, fingerprint, 'not-found', at)
      }
      if (plan.state !== 'draft' ||
        readOpaqueRevision('import-plan', command.expectedPlanRevision,
          command.planId) !== plan.revision) {
        return this.reject(
          client, command, memberId, kind, fingerprint, 'revision-conflict', at,
        )
      }

      const refreshed = await client.query(
        `WITH ready AS (
           SELECT item.source_list_id, item.source_item_id,
                  detail.source_observation_id, detail.place_candidate_id,
                  CASE WHEN detail.source_observation_id IS NULL THEN snapshot.id
                    ELSE NULL END AS evidence_snapshot_id
           FROM transfers.import_plan_items AS item
           JOIN transfers.import_plans AS owned_plan ON owned_plan.id = item.plan_id
           JOIN transfers.source_snapshots AS snapshot ON snapshot.id = owned_plan.snapshot_id
           JOIN transfers.source_snapshot_items AS snapshot_item
             ON snapshot_item.snapshot_id = owned_plan.snapshot_id
            AND snapshot_item.source_list_id = item.source_list_id
            AND snapshot_item.source_item_id = item.source_item_id
           LEFT JOIN ingestion.provider_place_detail_statuses AS detail_status
             ON detail_status.provider_key = snapshot.provider_key
            AND detail_status.provider_place_id = snapshot_item.provider_place_id
            AND detail_status.status = 'available'
           LEFT JOIN ingestion.provider_place_detail_observations AS detail
             ON detail.provider_key = detail_status.provider_key
            AND detail.provider_place_id = detail_status.provider_place_id
            AND detail.source_observation_id = detail_status.last_detail_observation_id
           WHERE item.plan_id = $1::uuid
             AND owned_plan.owner_membership_id = $2::uuid
             AND owned_plan.contract_major = 3
             AND owned_plan.state = 'draft'
             AND item.preview_status = 'unresolved'
             AND item.decision_kind = 'none'
             AND item.resolved_place_id IS NULL
             AND snapshot_item.canonical_place_id IS NULL
             AND snapshot_item.match_reason = 'missing-identity'
             AND snapshot_item.provider_place_id IS NOT NULL
             AND btrim(snapshot_item.observed_name) <> ''
             AND (detail.source_observation_id IS NOT NULL OR (
               snapshot.acquisition_kind IS NOT NULL AND snapshot.parser_version IS NOT NULL
             ))
         )
         UPDATE transfers.import_plan_items AS item
         SET preview_status = 'add', decision_kind = 'policy-create',
             evidence_source_observation_id = ready.source_observation_id,
             evidence_place_candidate_id = ready.place_candidate_id,
             evidence_snapshot_id = ready.evidence_snapshot_id
         FROM ready
         WHERE item.plan_id = $1::uuid
           AND item.source_list_id = ready.source_list_id
           AND item.source_item_id = ready.source_item_id`,
        [command.planId, memberId],
      )
      if ((refreshed.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE transfers.import_plans
           SET revision = revision + 1,
               updated_at = greatest(updated_at + interval '1 millisecond', $3::timestamptz)
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             AND contract_major = 3 AND state = 'draft'`,
          [command.planId, memberId, at],
        )
      }
      const value = await this.projection.getWithClientV3(client, memberId, command.planId)
      if (value === undefined) throw new Error('refreshed import plan projection unavailable')
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId,
        memberId,
        kind,
        fingerprint,
        value,
        at,
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
    command: RefreshEvidenceCommand,
    memberId: string,
    kind: string,
    fingerprint: string,
    code: Parameters<ProviderTransferContext['rejectInTransaction']>[1]['code'],
    at: string,
  ) {
    return this.context.rejectInTransaction<ImportPlanV3>(client, {
      commandId: command.commandId, memberId, kind, fingerprint, code, at,
    })
  }
}
