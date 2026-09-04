import { sha256 } from '../../../application/connector-capture.js'
import {
  outboundExecutionPlanDigest,
  readOpaqueRevision,
  transferFingerprint,
} from '../../../application/identity.js'
import type { TransferCommandResult } from '../../../domain/model.js'
import {
  ConnectorTransferAuthorizationError,
  type OutboundExecutionControl,
  type OutboundExecutionGrant,
} from '../../../domain/operations.js'
import {
  grantQuery,
  OutboundExecutionContext,
  type GrantRow,
  type TransferRow,
} from './execution-context.js'

export class OutboundExecutionGrants {
  constructor(private readonly context: OutboundExecutionContext) {}

  async issue(
    memberId: string,
    request: Parameters<OutboundExecutionControl['issueGrant']>[1],
  ): Promise<TransferCommandResult<OutboundExecutionGrant>> {
    const fingerprint = transferFingerprint({ memberId, request })
    const at = this.context.now()
    const expiresAt = new Date(at.getTime() + this.context.options.grantTtlMilliseconds)
    const token = this.context.nextToken()
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.outbound-grant:' || $1,0))",
        [request.transferId],
      )
      const transfer = (await client.query<TransferRow>(
        `SELECT transfer.id, transfer.owner_membership_id, transfer.connection_id,
                transfer.provider_key, transfer.collection_id, transfer.collection_version,
                transfer.plan_digest, transfer.target_kind, transfer.target_name,
                transfer.target_list_id, transfer.target_observation_version, transfer.state,
                transfer.revision::text, transfer.operation_id,
                (SELECT observation.account_fingerprint
                 FROM transfers.connection_observations AS observation
                 WHERE observation.connection_id = connection.id
                   AND observation.observed_state = 'ready'
                 ORDER BY observation.expected_connection_revision DESC,
                          observation.observation_id DESC LIMIT 1) AS account_fingerprint
         FROM transfers.outbound_transfers AS transfer
         JOIN transfers.provider_connections AS connection ON connection.id = transfer.connection_id
         WHERE transfer.id = $1::uuid AND transfer.owner_membership_id = $2::uuid FOR UPDATE`,
        [request.transferId, memberId],
      )).rows[0]
      if (transfer === undefined) {
        return await this.context.rejectGrant(client, request.commandId, 'not-found')
      }
      if (transfer.state !== 'approved' || transfer.operation_id === null ||
        transfer.target_observation_version === null || transfer.account_fingerprint === null) {
        return await this.context.rejectGrant(client, request.commandId, 'not-approvable')
      }
      const operation = (await client.query<{ state: string; cancel_requested: boolean }>(
        `SELECT state, cancel_requested FROM transfers.operations WHERE id = $1::uuid FOR UPDATE`,
        [transfer.operation_id],
      )).rows[0]
      if (operation === undefined || operation.cancel_requested || operation.state !== 'queued') {
        return await this.context.rejectGrant(client, request.commandId, 'not-approvable')
      }
      if (readOpaqueRevision('outbound-transfer', request.expectedTransferRevision,
        request.transferId) !== transfer.revision) {
        return await this.context.rejectGrant(client, request.commandId, 'revision-conflict')
      }
      if (request.accountFingerprint !== transfer.account_fingerprint) {
        return await this.context.rejectGrant(client, request.commandId, 'revision-conflict')
      }
      const manifest = await this.context.manifest(client, transfer)
      if (outboundExecutionPlanDigest({
        operationId: manifest.operationId,
        transferId: manifest.transferId,
        connectionId: manifest.connectionId,
        providerKey: manifest.providerKey,
        accountFingerprint: manifest.accountFingerprint,
        collectionId: manifest.collectionId,
        collectionRevision: manifest.collectionRevision,
        target: manifest.target,
        targetObservationRevision: manifest.targetObservationRevision,
        items: manifest.items,
      }) !== transfer.plan_digest) throw new Error('approved outbound manifest digest drift')

      const prior = (await client.query<GrantRow>(
        `${grantQuery} WHERE execution_grant.command_id = $1::uuid FOR UPDATE`,
        [request.commandId],
      )).rows[0]
      if (prior !== undefined) {
        if (prior.owner_membership_id !== memberId ||
          prior.request_fingerprint !== fingerprint || prior.id !== request.transferId) {
          await client.query('COMMIT')
          return {
            status: 'rejected', commandId: request.commandId,
            rejection: { code: 'command-id-reused' },
          }
        }
        const latest = Number((await client.query<{ generation: number }>(
          `SELECT max(generation)::int AS generation
           FROM transfers.outbound_execution_grants WHERE operation_id = $1::uuid`,
          [prior.operation_id],
        )).rows[0]!.generation)
        if (prior.generation !== latest || prior.grant_status === 'consumed') {
          await client.query('COMMIT')
          return {
            status: 'rejected', commandId: request.commandId,
            rejection: { code: 'not-approvable' },
          }
        }
        await client.query('COMMIT')
        return {
          status: 'rejected', commandId: request.commandId,
          rejection: { code: 'not-approvable' },
        }
      }
      const generation = Number((await client.query<{ generation: number }>(
        `SELECT coalesce(max(generation),0)::int + 1 AS generation
         FROM transfers.outbound_execution_grants WHERE operation_id = $1::uuid`,
        [transfer.operation_id],
      )).rows[0]!.generation)
      await client.query(
        `UPDATE transfers.outbound_execution_grants SET status = 'revoked'
         WHERE operation_id = $1::uuid AND status = 'issued'`, [transfer.operation_id],
      )
      const grantId = this.context.nextId()
      await client.query(
        `INSERT INTO transfers.outbound_execution_grants (
           grant_id, command_id, generation, operation_id, transfer_id, owner_membership_id,
           connection_id, provider_key, account_fingerprint, installation_id, plan_digest,
           target_kind, target_name, target_list_id, token_digest, request_fingerprint,
           place_origin, maximum_items, maximum_bytes, maximum_batches, status, issued_at, expires_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10::uuid,
           $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'issued',$21::timestamptz,$22::timestamptz)`,
        [grantId, request.commandId, generation, transfer.operation_id, transfer.id, memberId,
          transfer.connection_id, transfer.provider_key, transfer.account_fingerprint,
          request.installationId, transfer.plan_digest, transfer.target_kind,
          transfer.target_name, transfer.target_list_id, sha256(token), fingerprint,
          request.placeOrigin, manifest.items.filter((item) => item.action === 'add').length,
          this.context.options.maximumBytes, this.context.options.maximumBatches,
          at.toISOString(), expiresAt.toISOString()],
      )
      await client.query(
        `UPDATE transfers.operations SET stage = 'authorizing-execution', revision = revision + 1,
           updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [transfer.operation_id, at.toISOString()],
      )
      await client.query('COMMIT')
      const row: GrantRow = {
        ...transfer,
        grant_id: grantId,
        command_id: request.commandId,
        generation,
        installation_id: request.installationId,
        token_digest: sha256(token),
        request_fingerprint: fingerprint,
        place_origin: request.placeOrigin,
        maximum_items: manifest.items.filter((item) => item.action === 'add').length,
        maximum_bytes: this.context.options.maximumBytes,
        maximum_batches: this.context.options.maximumBatches,
        grant_status: 'issued',
        receipt_reference: null,
        receipt_token_digest: null,
        receipt_expires_at: null,
        reconciliation_expires_at: null,
        consumed_item_count: null,
        consumed_byte_count: null,
        consumed_batch_count: null,
        consumed_batch_size: null,
        issued_at: at,
        expires_at: expiresAt,
        consumed_at: null,
        operation_state: operation.state,
        cancel_requested: operation.cancel_requested,
      }
      return {
        status: 'applied',
        commandId: request.commandId,
        value: this.context.projectGrant(row, manifest, token, at, expiresAt),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async consume(input: Parameters<OutboundExecutionControl['consume']>[0]) {
    const client = await this.context.pool.connect()
    const receiptToken = this.context.nextToken()
    try {
      await client.query('BEGIN')
      const row = (await client.query<GrantRow>(
        `${grantQuery} WHERE execution_grant.grant_id = $1::uuid
           AND execution_grant.token_digest = $2 FOR UPDATE`,
        [input.request.grantId, sha256(input.token)],
      )).rows[0]
      if (row === undefined || row.place_origin !== input.request.sourceOrigin ||
        row.expires_at.getTime() <= this.context.now().getTime() || row.cancel_requested ||
        row.operation_state === 'cancelled') throw new ConnectorTransferAuthorizationError()
      const request = input.request
      if (row.operation_id !== request.operationId || row.connection_id !== request.connectionId ||
        row.provider_key !== request.providerKey ||
        row.account_fingerprint !== request.accountFingerprint ||
        row.installation_id !== request.installationId || row.plan_digest !== request.planDigest ||
        request.itemCount !== row.maximum_items || request.byteCount > row.maximum_bytes ||
        request.batchCount > row.maximum_batches ||
        request.batchCount !== Math.ceil(request.itemCount / request.batchSize)) {
        throw new ConnectorTransferAuthorizationError()
      }
      if (row.grant_status === 'consumed') {
        if (row.consumed_item_count !== request.itemCount ||
          row.consumed_byte_count !== request.byteCount ||
          row.consumed_batch_count !== request.batchCount ||
          row.consumed_batch_size !== request.batchSize) {
          throw new ConnectorTransferAuthorizationError()
        }
        await client.query(
          `UPDATE transfers.outbound_execution_grants SET receipt_token_digest = $2
           WHERE grant_id = $1::uuid`, [row.grant_id, sha256(receiptToken)],
        )
        await client.query('COMMIT')
        return this.context.projectReceipt(row, receiptToken, 'replayed')
      }
      if (row.grant_status !== 'issued') throw new ConnectorTransferAuthorizationError()
      const at = this.context.now()
      const receiptExpiresAt = new Date(
        at.getTime() + this.context.options.receiptTtlMilliseconds,
      )
      const reconciliationExpiresAt = new Date(at.getTime() +
        (this.context.options.reconciliationTtlMilliseconds ??
          this.context.options.receiptTtlMilliseconds * 24))
      const receiptReference = this.context.nextId()
      await client.query(
        `UPDATE transfers.outbound_execution_grants SET status = 'consumed',
           receipt_reference = $2::uuid, receipt_token_digest = $3,
           receipt_expires_at = $9::timestamptz, reconciliation_expires_at = $10::timestamptz,
           consumed_item_count = $4, consumed_byte_count = $5, consumed_batch_count = $6,
           consumed_batch_size = $7, consumed_at = $8::timestamptz WHERE grant_id = $1::uuid`,
        [row.grant_id, receiptReference, sha256(receiptToken), request.itemCount,
          request.byteCount, request.batchCount, request.batchSize, at.toISOString(),
          receiptExpiresAt.toISOString(), reconciliationExpiresAt.toISOString()],
      )
      await client.query(
        `UPDATE transfers.operations SET stage = 'executing-provider-write', state = 'running',
           revision = revision + 1, attempt_count = attempt_count + 1,
           updated_at = $2::timestamptz WHERE id = $1::uuid`,
        [row.operation_id, at.toISOString()],
      )
      await client.query('COMMIT')
      return this.context.projectReceipt({
        ...row,
        receipt_reference: receiptReference,
        receipt_expires_at: receiptExpiresAt,
        consumed_batch_size: request.batchSize,
        reconciliation_expires_at: reconciliationExpiresAt,
        consumed_at: at,
      }, receiptToken, 'consumed')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}
