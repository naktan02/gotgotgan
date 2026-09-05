import {
  deterministicOperationId,
  outboundExecutionPlanDigest,
  readOpaqueRevision,
} from '../../../application/identity.js'
import type {
  OutboundTransferCommandRequestV2,
  OutboundTransferV2,
  TransferCommandResult,
} from '../../../domain/model.js'
import { OutboundPlanProjection } from './outbound-plan-projection.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

export class ProviderOutboundPlans {
  private readonly projection: OutboundPlanProjection

  constructor(private readonly context: ProviderTransferContext) {
    this.projection = new OutboundPlanProjection(context)
  }

  async listTargetLists(memberId: string, connectionId: string) {
    const connection = (await this.context.pool.query<{
      provider_key: ProviderKey
      state: string
      account_fingerprint: string | null
    }>(
      `SELECT connection.provider_key, connection.state,
              (SELECT observation.account_fingerprint
               FROM transfers.connection_observations AS observation
               WHERE observation.connection_id = connection.id
                 AND observation.observed_state = 'ready'
               ORDER BY observation.expected_connection_revision DESC,
                        observation.observation_id DESC LIMIT 1) AS account_fingerprint
       FROM transfers.provider_connections AS connection
       WHERE connection.id = $1::uuid AND connection.owner_membership_id = $2::uuid`,
      [connectionId, memberId],
    )).rows[0]
    if (connection === undefined) return undefined
    if (connection.state !== 'ready') return {
      connectionId,
      availability: 'unavailable' as const,
      reason: 'connection-not-ready' as const,
      targetObservationRevision: null,
      items: [],
    }
    const target = this.context.targets.get(connection.provider_key)
    if (target === undefined) return {
      connectionId,
      availability: 'unavailable' as const,
      reason: 'target-adapter-unavailable' as const,
      targetObservationRevision: null,
      items: [],
    }
    const observation = await target.observe({ memberId, connectionId })
    return {
      connectionId,
      availability: 'available' as const,
      reason: null,
      targetObservationRevision: observation.revision,
      items: observation.lists,
    }
  }

  apply(
    memberId: string,
    command: OutboundTransferCommandRequestV2,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    return command.kind === 'preview'
      ? this.preview(memberId, command)
      : this.approve(memberId, command)
  }

  get(memberId: string, transferId: string) {
    return this.projection.get(memberId, transferId)
  }

  private async preview(
    memberId: string,
    command: Extract<OutboundTransferCommandRequestV2, { kind: 'preview' }>,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    const kind = 'outbound-transfer-preview'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const prior = await this.priorBeforeExternalIo({
      commandId: command.commandId, memberId, kind, fingerprint,
    })
    if (prior !== undefined) return prior
    const source = await this.context.collections.read({
      memberId,
      collectionId: command.collectionId,
    })
    if (source === undefined) return this.reject(
      command.commandId, memberId, kind, fingerprint, 'not-found', at,
    )
    if (source.collectionVersion !== command.expectedCollectionRevision) {
      return this.reject(
        command.commandId, memberId, kind, fingerprint, 'collection-changed', at,
      )
    }
    const selected = command.selection.kind === 'all'
      ? [...source.items]
      : command.selection.placeIds.map(
        (placeId) => source.items.find((item) => item.placeId === placeId),
      )
    if (selected.some((item) => item === undefined)) return this.reject(
      command.commandId, memberId, kind, fingerprint, 'invalid-selection', at,
    )
    const items = selected as Array<{ placeId: string; sourcePosition: number }>
    const connection = (await this.context.pool.query<{
      provider_key: ProviderKey
      state: string
      account_fingerprint: string | null
    }>(
      `SELECT connection.provider_key, connection.state,
              (SELECT observation.account_fingerprint
               FROM transfers.connection_observations AS observation
               WHERE observation.connection_id = connection.id
                 AND observation.observed_state = 'ready'
               ORDER BY observation.expected_connection_revision DESC,
                        observation.observation_id DESC LIMIT 1) AS account_fingerprint
       FROM transfers.provider_connections AS connection
       WHERE connection.id = $1::uuid AND connection.owner_membership_id = $2::uuid`,
      [command.connectionId, memberId],
    )).rows[0]
    if (connection === undefined) return this.reject(
      command.commandId, memberId, kind, fingerprint, 'not-found', at,
    )
    const target = this.context.targets.get(connection.provider_key)
    let state: 'draft' | 'blocked' = 'blocked'
    let blockedReason: 'connection-not-ready' | 'target-adapter-unavailable' | null = null
    let observationRevision: string | null = null
    let statuses: Array<{
      placeId: string
      status: 'add' | 'already-present' | 'unresolved' | 'unsupported' | 'unknown'
      targetProviderPlaceId: string | null
    }>
    if (connection.state !== 'ready' || connection.account_fingerprint === null) {
      blockedReason = 'connection-not-ready'
      statuses = items.map((item) => ({
        placeId: item.placeId, status: 'unknown', targetProviderPlaceId: null,
      }))
    } else if (target === undefined) {
      blockedReason = 'target-adapter-unavailable'
      statuses = items.map((item) => ({
        placeId: item.placeId, status: 'unknown', targetProviderPlaceId: null,
      }))
    } else {
      const preflight = await target.preflight({
        memberId,
        connectionId: command.connectionId,
        target: command.target,
        items,
      })
      state = 'draft'
      observationRevision = preflight.observationRevision
      statuses = [...preflight.items]
      const requestedIds = new Set(items.map((item) => item.placeId))
      const returnedIds = new Set(statuses.map((item) => item.placeId))
      if (statuses.length !== items.length || returnedIds.size !== requestedIds.size ||
        [...requestedIds].some((placeId) => !returnedIds.has(placeId))) {
        return this.reject(
          command.commandId, memberId, kind, fingerprint, 'target-unavailable', at,
        )
      }
    }
    const operationId = deterministicOperationId('outbound-execution', command.transferId)
    const planDigest = outboundExecutionPlanDigest({
      operationId,
      transferId: command.transferId,
      connectionId: command.connectionId,
      providerKey: connection.provider_key,
      accountFingerprint: connection.account_fingerprint!,
      collectionId: command.collectionId,
      collectionRevision: source.collectionVersion,
      target: command.target,
      targetObservationRevision: observationRevision!,
      items: items.map((item) => {
        const status = statuses.find((candidate) => candidate.placeId === item.placeId)!
        return {
          itemKey: item.placeId,
          placeId: item.placeId,
          targetProviderPlaceId: status.targetProviderPlaceId,
          action: status.status,
          sourcePosition: item.sourcePosition,
        }
      }),
    })
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const replay = await this.context.prior<OutboundTransferV2>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        (reference, receiptClient) => reference.kind === 'outbound-transfer'
          ? this.projection.getWithClient(receiptClient, memberId, reference.id)
          : Promise.resolve(undefined),
      )
      if (replay !== undefined && replay !== 'pending') {
        await client.query('COMMIT')
        return replay
      }
      await client.query(
        `INSERT INTO transfers.outbound_transfers (
           id, owner_membership_id, connection_id, provider_key, collection_id,
           collection_version, selection_kind, plan_digest, target_kind, target_name,
           target_list_id, target_observation_version, state, revision, blocked_reason,
           item_count, approval_command_id, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,
           $13,1,$14,$15,NULL,$16::timestamptz,$16::timestamptz)`,
        [command.transferId, memberId, command.connectionId, connection.provider_key,
          command.collectionId, source.collectionVersion, command.selection.kind, planDigest,
          command.target.kind, command.target.kind === 'new-list' ? command.target.name : null,
          command.target.kind === 'existing-list' ? command.target.targetListId : null,
          observationRevision, state, blockedReason, items.length, at],
      )
      for (const item of items) {
        const itemPreview = statuses.find(
          (candidate) => candidate.placeId === item.placeId,
        )!
        await client.query(
          `INSERT INTO transfers.outbound_transfer_items (
             transfer_id, canonical_place_id, source_position, preview_status,
             target_provider_place_id
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5)`,
          [command.transferId, item.placeId, item.sourcePosition,
            itemPreview.status, itemPreview.targetProviderPlaceId],
        )
      }
      const value = await this.projection.getWithClient(client, memberId, command.transferId)
      if (value === undefined) throw new Error('outbound preview projection unavailable')
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
        reference: {
          kind: 'outbound-transfer', id: value.transferId,
          acceptedRevision: value.transferRevision,
        },
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async approve(
    memberId: string,
    command: Extract<OutboundTransferCommandRequestV2, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    const kind = 'outbound-transfer-approve'
    const fingerprint = this.context.fingerprint({ memberId, command })
    const at = this.context.now().toISOString()
    const prior = await this.priorBeforeExternalIo({
      commandId: command.commandId, memberId, kind, fingerprint,
    })
    if (prior !== undefined) return prior
    const preview = await this.projection.get(memberId, command.transferId)
    const targetBeforeLock = preview === undefined
      ? undefined
      : this.context.targets.get(preview.providerKey)
    const targetObservation = preview === undefined ||
      preview.targetObservationRevision === null || targetBeforeLock === undefined
      ? undefined
      : await targetBeforeLock.observe({ memberId, connectionId: preview.connectionId })
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, command.commandId)
      const replay = await this.context.prior<OutboundTransferV2>(
        client,
        { commandId: command.commandId, memberId, kind, fingerprint },
        (reference, receiptClient) => reference.kind === 'outbound-transfer'
          ? this.projection.getWithClient(receiptClient, memberId, reference.id)
          : Promise.resolve(undefined),
      )
      if (replay !== undefined && replay !== 'pending') {
        await client.query('COMMIT')
        return replay
      }
      const transfer = (await client.query<{
        revision: string
        state: string
        blocked_reason: string | null
        collection_id: string
        collection_version: string
        connection_id: string
        provider_key: ProviderKey
        target_observation_version: string | null
      }>(
        `SELECT revision::text, state, blocked_reason, collection_id, collection_version,
                connection_id, provider_key, target_observation_version
         FROM transfers.outbound_transfers
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [command.transferId, memberId],
      )).rows[0]
      if (transfer === undefined) return this.rejectInTransaction(
        client, command.commandId, memberId, kind, fingerprint, 'not-found', at,
      )
      if (transfer.state === 'blocked') return this.rejectInTransaction(
        client, command.commandId, memberId, kind, fingerprint,
        transfer.blocked_reason === 'connection-not-ready'
          ? 'connection-not-ready' : 'target-unavailable', at,
      )
      if (transfer.state !== 'draft' ||
        readOpaqueRevision('outbound-transfer', command.expectedTransferRevision,
          command.transferId) !== transfer.revision) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'revision-conflict', at,
        )
      }
      const ineligibleItems = Number((await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM transfers.outbound_transfer_items
         WHERE transfer_id = $1::uuid
           AND (preview_status IN ('unresolved', 'unsupported', 'unknown')
             OR (preview_status IN ('add', 'already-present')
               AND target_provider_place_id IS NULL))`,
        [command.transferId],
      )).rows[0]!.count)
      if (ineligibleItems > 0) return this.rejectInTransaction(
        client, command.commandId, memberId, kind, fingerprint, 'not-approvable', at,
      )
      const source = await this.context.collections.read({
        memberId,
        collectionId: transfer.collection_id,
      })
      if (source === undefined || source.collectionVersion !== transfer.collection_version) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'collection-changed', at,
        )
      }
      const connection = (await client.query<{
        state: string
        account_fingerprint: string | null
        label: string
      }>(
        `SELECT connection.state, connection.label,
                (SELECT observation.account_fingerprint
                 FROM transfers.connection_observations AS observation
                 WHERE observation.connection_id = connection.id
                   AND observation.observed_state = 'ready'
                 ORDER BY observation.expected_connection_revision DESC,
                          observation.observation_id DESC LIMIT 1) AS account_fingerprint
         FROM transfers.provider_connections AS connection
         WHERE connection.id = $1::uuid AND connection.owner_membership_id = $2::uuid FOR SHARE`,
        [transfer.connection_id, memberId],
      )).rows[0]
      if (connection?.state !== 'ready' || connection.account_fingerprint === null) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'connection-not-ready', at,
        )
      }
      if (targetBeforeLock === undefined || targetObservation === undefined) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint, 'target-unavailable', at,
        )
      }
      if (targetObservation.revision !== transfer.target_observation_version) {
        return this.rejectInTransaction(
          client, command.commandId, memberId, kind, fingerprint,
          'target-observation-changed', at,
        )
      }
      const operationId = deterministicOperationId('outbound-execution', command.transferId)
      await client.query(
        `INSERT INTO transfers.operations (
           id, owner_membership_id, kind, provider_key, connection_id, account_label,
           import_source_id, import_source_kind,
           resource_kind, resource_id, stage, state, total_count, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'outbound-transfer',$3,$4::uuid,$5,
           $4::uuid,'verified-connection',
           'outbound-transfer',$6::uuid,'preview-approved','queued',
           (SELECT item_count FROM transfers.outbound_transfers WHERE id = $6::uuid),
           $7::timestamptz,$7::timestamptz)`,
        [operationId, memberId, transfer.provider_key, transfer.connection_id,
          connection.label, command.transferId, at],
      )
      await client.query(
        `UPDATE transfers.outbound_transfers
         SET state = 'approved', approval_command_id = $3::uuid, revision = revision + 1,
             operation_id = $5::uuid,
             updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [command.transferId, memberId, command.commandId, at, operationId],
      )
      await client.query(
        `INSERT INTO transfers.operation_items (
           operation_id, item_key, canonical_place_id, target_reference, status,
           source_position, updated_at
         ) SELECT $1::uuid, canonical_place_id::text, canonical_place_id,
                  target_provider_place_id,
                  CASE WHEN preview_status = 'already-present'
                    THEN 'already-present' ELSE 'pending' END,
                  source_position, $3::timestamptz
           FROM transfers.outbound_transfer_items WHERE transfer_id = $2::uuid`,
        [operationId, command.transferId, at],
      )
      const needsProviderWrite = (await client.query(
        `SELECT 1 FROM transfers.outbound_transfer_items
         WHERE transfer_id = $1::uuid AND preview_status = 'add' LIMIT 1`,
        [command.transferId],
      )).rowCount !== 0
      if (!needsProviderWrite) {
        await client.query(
          `UPDATE transfers.operations SET stage = 'externally-completed', state = 'completed',
             processed_count = total_count, applied_count = total_count, revision = revision + 1,
             updated_at = $2::timestamptz, completed_at = $2::timestamptz WHERE id = $1::uuid`,
          [operationId, at],
        )
        await client.query(
          `UPDATE transfers.outbound_transfers SET state = 'completed', revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $2::timestamptz)
           WHERE id = $1::uuid`, [command.transferId, at],
        )
      }
      const value = await this.projection.getWithClient(client, memberId, command.transferId)
      if (value === undefined) throw new Error('approved outbound projection unavailable')
      const result = await this.context.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
        reference: {
          kind: 'outbound-transfer', id: value.transferId,
          acceptedRevision: value.transferRevision,
        },
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async priorBeforeExternalIo(input: Readonly<{
    commandId: string
    memberId: string
    kind: string
    fingerprint: string
  }>): Promise<TransferCommandResult<OutboundTransferV2> | undefined> {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await this.context.lockCommand(client, input.commandId)
      const prior = await this.context.prior<OutboundTransferV2>(
        client,
        input,
        (reference, receiptClient) => reference.kind === 'outbound-transfer'
          ? this.projection.getWithClient(receiptClient, input.memberId, reference.id)
          : Promise.resolve(undefined),
      )
      if (prior === 'pending') throw new Error('outbound command cannot remain pending')
      await client.query('COMMIT')
      return prior
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
    return this.context.rejectStandalone<OutboundTransferV2>({
      commandId, memberId, kind, fingerprint, code, at,
      resolveReference: (reference, client) => reference.kind === 'outbound-transfer'
        ? this.projection.getWithClient(client, memberId, reference.id)
        : Promise.resolve(undefined),
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
    return this.context.rejectInTransaction<OutboundTransferV2>(client, {
      commandId, memberId, kind, fingerprint, code, at,
    })
  }
}
