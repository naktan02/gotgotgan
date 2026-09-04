import type { PoolClient } from 'pg'

import { outboundVersion } from '../../../application/identity.js'
import type { OutboundTransferV2 } from '../../../domain/model.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

export class OutboundPlanProjection {
  constructor(private readonly context: ProviderTransferContext) {}

  async get(memberId: string, transferId: string) {
    const client = await this.context.pool.connect()
    try {
      return await this.getWithClient(client, memberId, transferId)
    } finally { client.release() }
  }

  async getWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    transferId: string,
  ): Promise<OutboundTransferV2 | undefined> {
    const transfer = (await client.query<{
      id: string
      revision: string
      provider_key: ProviderKey
      connection_id: string
      collection_id: string
      collection_version: string
      selection_kind: 'all' | 'places'
      plan_digest: string
      target_kind: 'new-list' | 'existing-list'
      target_name: string | null
      target_list_id: string | null
      target_observation_version: string | null
      state: OutboundTransferV2['state']
      blocked_reason: 'target-adapter-unavailable' | 'connection-not-ready' | 'apply-failed' | null
      item_count: number
      approval_command_id: string | null
      created_at: Date
      updated_at: Date
    }>(
      `SELECT id, revision::text, provider_key, connection_id, collection_id,
              collection_version, selection_kind, plan_digest, target_kind,
              target_name, target_list_id, target_observation_version, state,
              blocked_reason, item_count, approval_command_id, created_at, updated_at
       FROM transfers.outbound_transfers
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [transferId, memberId],
    )).rows[0]
    if (transfer === undefined) return undefined
    const items = await client.query<{
      canonical_place_id: string
      preview_status: OutboundTransferV2['preview']['items'][number]['status']
      target_provider_place_id: string | null
    }>(
      `SELECT canonical_place_id, preview_status, target_provider_place_id
       FROM transfers.outbound_transfer_items
       WHERE transfer_id = $1::uuid ORDER BY source_position, canonical_place_id`,
      [transferId],
    )
    const unavailable = transfer.target_observation_version === null
    const count = (status: string) =>
      items.rows.filter((item) => item.preview_status === status).length
    return {
      schemaVersion: 'outbound-transfer.v2',
      transferId: transfer.id,
      transferRevision: outboundVersion(transfer.id, transfer.revision),
      providerKey: transfer.provider_key,
      connectionId: transfer.connection_id,
      collectionId: transfer.collection_id,
      collectionRevision: transfer.collection_version,
      target: transfer.target_kind === 'new-list'
        ? { kind: 'new-list', name: transfer.target_name! }
        : { kind: 'existing-list', targetListId: transfer.target_list_id! },
      targetObservationRevision: transfer.target_observation_version,
      planDigest: transfer.plan_digest,
      state: transfer.state,
      selection: transfer.selection_kind === 'all'
        ? { kind: 'all' }
        : { kind: 'places', placeIds: items.rows.map((item) => item.canonical_place_id) },
      itemCount: transfer.item_count,
      preview: {
        availability: unavailable ? 'unavailable' : 'available',
        addCount: unavailable ? null : count('add'),
        alreadyPresentCount: unavailable ? null : count('already-present'),
        unresolvedCount: unavailable ? null : count('unresolved'),
        unsupportedCount: unavailable ? null : count('unsupported'),
        items: items.rows.map((item) => ({
          placeId: item.canonical_place_id,
          status: item.preview_status,
          targetProviderPlaceId: item.target_provider_place_id,
        })),
      },
      approval: {
        eligible: transfer.state === 'draft' &&
          !items.rows.some((item) =>
            ['unresolved', 'unsupported', 'unknown'].includes(item.preview_status)),
        reason: transfer.state === 'blocked'
          ? transfer.blocked_reason
          : transfer.state === 'draft'
            ? items.rows.some((item) =>
              ['unresolved', 'unsupported', 'unknown'].includes(item.preview_status))
              ? 'preview-has-unresolved-items'
              : null
            : 'already-decided',
      },
      approvalReceipt: transfer.approval_command_id === null
        ? null
        : {
            commandId: transfer.approval_command_id,
            planDigest: transfer.plan_digest,
            approvedAt: transfer.updated_at.toISOString(),
          },
      createdAt: transfer.created_at.toISOString(),
      updatedAt: transfer.updated_at.toISOString(),
    }
  }
}
