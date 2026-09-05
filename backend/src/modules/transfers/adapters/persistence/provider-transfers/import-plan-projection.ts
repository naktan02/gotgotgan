import type { PoolClient } from 'pg'

import { planVersion, snapshotVersion } from '../../../application/identity.js'
import type { ImportPlanV2, ImportPlanV3, ImportPlanV4 } from '../../../domain/model.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'
import { projectImportSource } from './source-snapshot-projection.js'

type ImportPlanV2Decision = ImportPlanV2[
  'mappings'
][number]['preview']['items'][number]['decision']

export class ImportPlanProjection {
  constructor(private readonly context: ProviderTransferContext) {}

  async getV2(memberId: string, planId: string): Promise<ImportPlanV2 | undefined> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const value = await this.getWithClient(client, memberId, planId, 2, false)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async getV3(memberId: string, planId: string): Promise<ImportPlanV3 | undefined> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const value = await this.getWithClient(client, memberId, planId, 3, false)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async getV4(memberId: string, planId: string): Promise<ImportPlanV4 | undefined> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const value = await this.getWithClient(client, memberId, planId, 4, false)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  getWithClientV2(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
  ): Promise<ImportPlanV2 | undefined> {
    return this.getWithClient(client, memberId, planId, 2, true)
  }

  getWithClientV3(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
  ): Promise<ImportPlanV3 | undefined> {
    return this.getWithClient(client, memberId, planId, 3, true)
  }

  getWithClientV4(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
  ): Promise<ImportPlanV4 | undefined> {
    return this.getWithClient(client, memberId, planId, 4, true)
  }

  private getWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
    contractMajor: 2,
    lockPlan: boolean,
  ): Promise<ImportPlanV2 | undefined>
  private getWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
    contractMajor: 3,
    lockPlan: boolean,
  ): Promise<ImportPlanV3 | undefined>
  private getWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
    contractMajor: 4,
    lockPlan: boolean,
  ): Promise<ImportPlanV4 | undefined>
  private async getWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
    contractMajor: 2 | 3 | 4,
    lockPlan: boolean,
  ): Promise<ImportPlanV2 | ImportPlanV3 | ImportPlanV4 | undefined> {
    const planLock = lockPlan ? 'FOR SHARE OF plan' : ''
    const plan = (await client.query<{
      id: string
      revision: string
      state: ImportPlanV3['state']
      blocked_reason: string | null
      snapshot_id: string
      snapshot_digest: string
      provider_key: ProviderKey
      import_source_id: string
      source_kind: 'verified-connection' | 'one-shot'
      connection_id: string | null
      acquisition_method: 'shared-link' | 'remote-browser' | null
      authorization_basis: 'link-possession' | 'interactive-provider-session' | null
      created_at: Date
      updated_at: Date
    }>(
      `SELECT plan.id, plan.revision::text, plan.state, plan.blocked_reason,
              plan.snapshot_id, plan.snapshot_digest, snapshot.provider_key,
              snapshot.import_source_id, source.source_kind, source.connection_id,
              source.acquisition_method, source.authorization_basis,
              plan.created_at, plan.updated_at
       FROM transfers.import_plans AS plan
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       JOIN transfers.import_sources AS source
         ON source.id = snapshot.import_source_id
        AND source.owner_membership_id = snapshot.owner_membership_id
        AND source.provider_key = snapshot.provider_key
        AND source.source_kind = snapshot.import_source_kind
       WHERE plan.id = $1::uuid AND plan.owner_membership_id = $2::uuid
         AND plan.contract_major = $3
       ${planLock}`,
      [planId, memberId, contractMajor],
    )).rows[0]
    if (plan === undefined) return undefined
    const mappings = await client.query<{
      source_list_id: string
      observed_name: string
      source_position: number
      target_kind: 'new' | 'existing'
      target_collection_id: string
      target_name: string | null
      expected_collection_version: string | null
      materialization_state: 'pending' | 'applied' | 'rejected'
      collection_version: string | null
      rejection_code: string | null
    }>(
      `SELECT mapping.source_list_id, list.observed_name, list.source_position,
              mapping.target_kind, mapping.target_collection_id, mapping.target_name,
              mapping.expected_collection_version, mapping.materialization_state,
              mapping.collection_version, mapping.rejection_code
       FROM transfers.import_plan_mappings AS mapping
       JOIN transfers.source_snapshot_lists AS list
         ON list.snapshot_id = $2::uuid AND list.source_list_id = mapping.source_list_id
       WHERE mapping.plan_id = $1::uuid
       ORDER BY list.source_position, list.source_list_id`,
      [planId, plan.snapshot_id],
    )
    const projectedMappings: ImportPlanV3['mappings'][number][] = []
    for (const mapping of mappings.rows) {
      const items = await client.query<{
        source_item_id: string
        provider_place_id: string | null
        observed_name: string
        observed_address: string | null
        resolved_place_id: string | null
        preview_status: 'add' | 'already-present' | 'unresolved' | 'skipped'
        decision_kind: 'snapshot-match' | 'policy-create' | 'link' | 'skip' | 'none'
        provider_detail_status: 'pending' | 'available' | 'unavailable' | null
      }>(
        `SELECT planned.source_item_id, snapshot_item.provider_place_id,
                snapshot_item.observed_name, snapshot_item.observed_address,
                planned.resolved_place_id, planned.preview_status, planned.decision_kind,
                detail_status.status AS provider_detail_status
         FROM transfers.import_plan_items AS planned
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = $3::uuid
          AND snapshot_item.source_list_id = planned.source_list_id
          AND snapshot_item.source_item_id = planned.source_item_id
         LEFT JOIN ingestion.provider_place_detail_statuses AS detail_status
           ON detail_status.provider_key = $4
          AND detail_status.provider_place_id = snapshot_item.provider_place_id
         WHERE planned.plan_id = $1::uuid AND planned.source_list_id = $2
         ORDER BY snapshot_item.source_position, planned.source_item_id`,
        [planId, mapping.source_list_id, plan.snapshot_id, plan.provider_key],
      )
      const counts = (status: string) =>
        items.rows.filter((item) => item.preview_status === status).length
      if (contractMajor === 2 && items.rows.some(
        (item) => item.decision_kind === 'policy-create',
      )) {
        throw new Error('import-plan-contract-major-mismatch')
      }
      projectedMappings.push({
        sourceListId: mapping.source_list_id,
        observedName: mapping.observed_name,
        sourcePosition: mapping.source_position,
        target: mapping.target_kind === 'new'
          ? {
              kind: 'new',
              collectionId: mapping.target_collection_id,
              name: mapping.target_name!,
            }
          : {
              kind: 'existing',
              collectionId: mapping.target_collection_id,
              expectedCollectionRevision: mapping.expected_collection_version!,
            },
        itemCount: items.rows.length,
        unresolvedItemCount: counts('unresolved'),
        preview: {
          addCount: counts('add'),
          alreadyPresentCount: counts('already-present'),
          unresolvedCount: counts('unresolved'),
          skippedCount: counts('skipped'),
          items: items.rows.map((item) => ({
            sourceItemId: item.source_item_id,
            providerPlaceId: item.provider_place_id,
            observedName: item.observed_name,
            observedAddress: item.observed_address,
            placeId: item.resolved_place_id,
            status: item.preview_status,
            decision: item.decision_kind,
            providerDetailStatus: item.provider_detail_status,
          })),
        },
        materialization: {
          state: mapping.materialization_state,
          collectionRevision: mapping.collection_version,
          rejectionCode: mapping.rejection_code,
        },
      })
    }
    const unresolved = projectedMappings.reduce(
      (sum, mapping) => sum + mapping.unresolvedItemCount,
      0,
    )
    const decided = plan.state !== 'draft'
    const approval: ImportPlanV3['approval'] = {
      eligible: !decided && unresolved === 0,
      reason: decided
        ? plan.blocked_reason === 'materialization-rejected'
          ? 'materialization-rejected'
          : 'already-decided'
        : unresolved > 0 ? 'unresolved-places' : null,
    }
    const value = {
      planId: plan.id,
      planRevision: planVersion(plan.id, plan.revision),
      snapshotId: plan.snapshot_id,
      snapshotVersion: snapshotVersion(plan.snapshot_id, plan.snapshot_digest),
      providerKey: plan.provider_key,
      state: plan.state,
      approval,
      mappings: projectedMappings,
      createdAt: plan.created_at.toISOString(),
      updatedAt: plan.updated_at.toISOString(),
    }
    if (contractMajor === 4) {
      return {
        schemaVersion: 'import-plan.v4',
        ...value,
        source: projectImportSource(plan),
      }
    }
    if (plan.connection_id === null) throw new Error('connected import plan lost its connection')
    if (contractMajor === 3) {
      return { schemaVersion: 'import-plan.v3', ...value, connectionId: plan.connection_id }
    }
    return {
      schemaVersion: 'import-plan.v2',
      ...value,
      connectionId: plan.connection_id,
      mappings: value.mappings.map((mapping) => ({
        ...mapping,
        preview: {
          ...mapping.preview,
          items: mapping.preview.items.map(({ providerDetailStatus: _, ...item }) => ({
            ...item,
            decision: item.decision as ImportPlanV2Decision,
          })),
        },
      })),
    }
  }
}
