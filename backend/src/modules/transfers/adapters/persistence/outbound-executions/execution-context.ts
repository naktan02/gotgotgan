import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import { sha256 } from '../../../application/connector-capture.js'
import type { ProviderKey, TransferCommandResult } from '../../../domain/model.js'
import {
  ConnectorTransferAuthorizationError,
  type OutboundExecutionAttempt,
  type OutboundExecutionAttemptIntent,
  type OutboundExecutionGrant,
  type OutboundExecutionManifest,
  type TransferOperationQueries,
} from '../../../domain/operations.js'

export type TransferRow = Readonly<{
  id: string
  owner_membership_id: string
  connection_id: string
  provider_key: ProviderKey
  collection_id: string
  collection_version: string
  plan_digest: string
  target_kind: 'new-list' | 'existing-list'
  target_name: string | null
  target_list_id: string | null
  target_observation_version: string | null
  state: string
  revision: string
  operation_id: string | null
  account_fingerprint: string | null
}>

export type GrantRow = TransferRow & Readonly<{
  grant_id: string
  command_id: string
  generation: number
  installation_id: string
  token_digest: string
  request_fingerprint: string
  place_origin: string
  maximum_items: number
  maximum_bytes: number
  maximum_batches: number
  grant_status: 'issued' | 'consumed' | 'revoked' | 'expired'
  receipt_reference: string | null
  receipt_token_digest: string | null
  receipt_expires_at: Date | null
  reconciliation_expires_at: Date | null
  consumed_item_count: number | null
  consumed_byte_count: number | null
  consumed_batch_count: number | null
  consumed_batch_size: number | null
  issued_at: Date
  expires_at: Date
  consumed_at: Date | null
  operation_state: string
  cancel_requested: boolean
}>

export type OutboundExecutionOptions = Readonly<{
  grantTtlMilliseconds: number
  receiptTtlMilliseconds: number
  reconciliationTtlMilliseconds?: number
  maximumBytes: number
  maximumBatches: number
  nextId?: () => string
  nextToken?: () => string
  now?: () => Date
}>

export const grantQuery = `SELECT execution_grant.grant_id, execution_grant.command_id, execution_grant.generation,
  execution_grant.installation_id, execution_grant.token_digest, execution_grant.request_fingerprint, execution_grant.place_origin,
  execution_grant.maximum_items, execution_grant.maximum_bytes, execution_grant.maximum_batches,
  execution_grant.status AS grant_status, execution_grant.receipt_reference, execution_grant.receipt_token_digest,
  execution_grant.receipt_expires_at, execution_grant.reconciliation_expires_at,
  execution_grant.consumed_item_count, execution_grant.consumed_byte_count, execution_grant.consumed_batch_count,
  execution_grant.consumed_batch_size,
  execution_grant.issued_at, execution_grant.expires_at, execution_grant.consumed_at,
  transfer.id, transfer.owner_membership_id, transfer.connection_id, transfer.provider_key,
  transfer.collection_id, transfer.collection_version, transfer.plan_digest,
  transfer.target_kind, transfer.target_name, transfer.target_list_id,
  transfer.target_observation_version, transfer.state, transfer.revision::text,
  transfer.operation_id,
  (SELECT observation.account_fingerprint
   FROM transfers.connection_observations AS observation
   WHERE observation.connection_id = connection.id AND observation.observed_state = 'ready'
   ORDER BY observation.expected_connection_revision DESC, observation.observation_id DESC
   LIMIT 1) AS account_fingerprint
  ,operation.state AS operation_state, operation.cancel_requested
 FROM transfers.outbound_execution_grants AS execution_grant
 JOIN transfers.outbound_transfers AS transfer ON transfer.id = execution_grant.transfer_id
 JOIN transfers.provider_connections AS connection ON connection.id = transfer.connection_id
 JOIN transfers.operations AS operation ON operation.id = execution_grant.operation_id`

export class OutboundExecutionContext {
  constructor(
    readonly pool: Pool,
    readonly operations: TransferOperationQueries,
    readonly options: OutboundExecutionOptions,
  ) {}

  get now() { return this.options.now ?? (() => new Date()) }
  get nextId() { return this.options.nextId ?? randomUUID }
  get nextToken() {
    return this.options.nextToken ?? (() => randomBytes(32).toString('base64url'))
  }

  async manifest(
    client: Pick<PoolClient, 'query'>,
    transfer: TransferRow,
  ): Promise<OutboundExecutionManifest> {
    const items = await client.query<{
      canonical_place_id: string
      target_provider_place_id: string | null
      source_position: number
      preview_status: 'add' | 'already-present'
    }>(
      `SELECT canonical_place_id, target_provider_place_id, source_position, preview_status
       FROM transfers.outbound_transfer_items WHERE transfer_id = $1::uuid
       ORDER BY source_position, canonical_place_id`,
      [transfer.id],
    )
    if (items.rows.some((item) => item.target_provider_place_id === null) ||
      transfer.operation_id === null || transfer.account_fingerprint === null ||
      transfer.target_observation_version === null) {
      throw new Error('outbound manifest is unresolved')
    }
    return {
      operationId: transfer.operation_id,
      transferId: transfer.id,
      connectionId: transfer.connection_id,
      providerKey: transfer.provider_key,
      accountFingerprint: transfer.account_fingerprint,
      collectionId: transfer.collection_id,
      collectionRevision: transfer.collection_version,
      targetObservationRevision: transfer.target_observation_version,
      target: transfer.target_kind === 'new-list'
        ? { kind: 'new-list', name: transfer.target_name! }
        : { kind: 'existing-list', targetListId: transfer.target_list_id! },
      planDigest: transfer.plan_digest,
      items: items.rows.map((item) => ({
        itemKey: item.canonical_place_id,
        placeId: item.canonical_place_id,
        targetProviderPlaceId: item.target_provider_place_id!,
        action: item.preview_status,
        sourcePosition: item.source_position,
      })),
    }
  }

  projectGrant(
    row: GrantRow,
    manifest: OutboundExecutionManifest,
    token: string,
    issuedAt: Date,
    expiresAt: Date,
  ): OutboundExecutionGrant {
    return {
      grantId: row.grant_id,
      operationId: manifest.operationId,
      transferId: row.id,
      connectionId: row.connection_id,
      providerKey: row.provider_key,
      accountFingerprint: row.account_fingerprint!,
      installationId: row.installation_id,
      planDigest: row.plan_digest,
      token,
      placeOrigin: row.place_origin,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      limits: {
        maximumItems: row.maximum_items,
        maximumBytes: row.maximum_bytes,
        maximumBatches: row.maximum_batches,
      },
      manifest,
    }
  }

  projectReceipt(row: GrantRow, receiptToken: string, status: 'consumed' | 'replayed') {
    return {
      status,
      grantId: row.grant_id,
      receiptReference: row.receipt_reference!,
      receiptToken,
      operationId: row.operation_id!,
      transferId: row.id,
      connectionId: row.connection_id,
      providerKey: row.provider_key,
      accountFingerprint: row.account_fingerprint!,
      installationId: row.installation_id,
      planDigest: row.plan_digest,
      batchSize: row.consumed_batch_size!,
      authorizedAt: row.consumed_at!.toISOString(),
      expiresAt: row.receipt_expires_at!.toISOString(),
      reconciliationExpiresAt: row.reconciliation_expires_at!.toISOString(),
      limits: {
        maximumItems: row.maximum_items,
        maximumBytes: row.maximum_bytes,
        maximumBatches: row.maximum_batches,
      },
    }
  }

  async authorizeReceipt(
    client: PoolClient,
    token: string,
    origin: string,
    operationId: string,
    receiptReference: string,
    purpose: 'attempt' | 'unknown-attempt' | 'reconciliation',
  ): Promise<GrantRow> {
    const row = (await client.query<GrantRow>(
      `${grantQuery} WHERE execution_grant.operation_id = $1::uuid
         AND execution_grant.receipt_reference = $2::uuid
         AND execution_grant.receipt_token_digest = $3 FOR UPDATE`,
      [operationId, receiptReference, sha256(token)],
    )).rows[0]
    const expiresAt = purpose === 'attempt'
      ? row?.receipt_expires_at
      : row?.reconciliation_expires_at
    if (row === undefined || row.grant_status !== 'consumed' || row.place_origin !== origin ||
      expiresAt === null || expiresAt === undefined ||
      expiresAt.getTime() <= this.now().getTime() || row.operation_state === 'cancelled') {
      throw new ConnectorTransferAuthorizationError()
    }
    return row
  }

  async validateAttemptIntent(
    client: PoolClient,
    grant: GrantRow,
    intent: OutboundExecutionAttemptIntent,
  ) {
    if (new Set(intent.items.map((item) => item.itemKey)).size !== intent.items.length) {
      throw new ConnectorTransferAuthorizationError()
    }
    if (intent.phase === 'create-target-list') {
      if (grant.target_kind !== 'new-list' || !intent.final || intent.sequence !== 0 ||
        intent.targetListId !== null || intent.items.length !== 0) {
        throw new ConnectorTransferAuthorizationError()
      }
      return
    }
    if (grant.consumed_batch_size === null || grant.consumed_batch_count === null ||
      intent.sequence >= grant.consumed_batch_count) {
      throw new ConnectorTransferAuthorizationError()
    }
    let expectedTargetListId = grant.target_list_id
    if (grant.target_kind === 'new-list') {
      expectedTargetListId = (await client.query<{ target_list_id: string }>(
        `SELECT target_list_id FROM transfers.outbound_execution_attempt_intents
         WHERE operation_id = $1::uuid AND phase = 'create-target-list'
           AND state IN ('completed','reconciled-completed') AND target_list_id IS NOT NULL
         ORDER BY prepared_at DESC LIMIT 1`, [intent.operationId],
      )).rows[0]?.target_list_id ?? null
    }
    if (expectedTargetListId === null || intent.targetListId !== expectedTargetListId) {
      throw new ConnectorTransferAuthorizationError()
    }
    const priorSequences = Number((await client.query<{ count: number }>(
      `SELECT count(DISTINCT sequence)::int AS count
       FROM transfers.outbound_execution_attempt_intents
       WHERE operation_id = $1::uuid AND phase = 'add-items'
         AND state IN ('completed','reconciled-completed') AND sequence < $2`,
      [intent.operationId, intent.sequence],
    )).rows[0]!.count)
    if (priorSequences !== intent.sequence) throw new ConnectorTransferAuthorizationError()
    const expectedItems = await client.query<{ item_key: string; target_reference: string }>(
      `SELECT item_key, target_reference FROM transfers.operation_items
       WHERE operation_id = $1::uuid AND status <> 'already-present'
       ORDER BY source_position, item_key OFFSET $2 LIMIT $3`,
      [intent.operationId, intent.sequence * grant.consumed_batch_size,
        grant.consumed_batch_size],
    )
    if (expectedItems.rows.length !== intent.items.length ||
      expectedItems.rows.some((item, index) => item.item_key !== intent.items[index]?.itemKey ||
        item.target_reference !== intent.items[index]?.targetReference) ||
      intent.final !== (intent.sequence === grant.consumed_batch_count - 1)) {
      throw new ConnectorTransferAuthorizationError()
    }
  }

  async validatePreparedAttempt(
    client: PoolClient,
    grant: GrantRow,
    attempt: OutboundExecutionAttempt,
  ) {
    if ((attempt.outcome === 'partial') !== ((attempt.problem ?? null) !== null) ||
      attempt.items.some((item) => item.status === 'outcome-unknown' &&
        item.reconciliationReference !== attempt.reconciliationReference)) {
      throw new ConnectorTransferAuthorizationError()
    }
    const intent = (await client.query<{
      phase: 'create-target-list' | 'add-items'
      target_list_id: string | null
      sequence: number
      final: boolean
      reconciliation_reference: string
      state: string
    }>(
      `SELECT phase, target_list_id, sequence, final, reconciliation_reference, state
       FROM transfers.outbound_execution_attempt_intents
       WHERE attempt_id = $1::uuid AND operation_id = $2::uuid
         AND grant_id = $3::uuid AND receipt_reference = $4::uuid FOR UPDATE`,
      [attempt.attemptId, attempt.operationId, grant.grant_id, attempt.receiptReference],
    )).rows[0]
    if (intent === undefined || !['prepared','expired'].includes(intent.state) ||
      intent.phase !== attempt.phase || intent.sequence !== attempt.sequence ||
      intent.final !== attempt.final ||
      intent.reconciliation_reference !==
        (attempt.reconciliationReference ?? intent.reconciliation_reference) ||
      (attempt.phase === 'add-items' && intent.target_list_id !== attempt.targetListId) ||
      (attempt.phase === 'create-target-list' && attempt.outcome === 'completed' &&
        attempt.targetListId === null)) {
      throw new ConnectorTransferAuthorizationError()
    }
    const expectedItems = await client.query<{ item_key: string; target_reference: string }>(
      `SELECT item_key, target_reference
       FROM transfers.outbound_execution_attempt_intent_items
       WHERE attempt_id = $1::uuid ORDER BY item_key`, [attempt.attemptId],
    )
    const actualItems = [...attempt.items]
      .sort((left, right) => left.itemKey.localeCompare(right.itemKey))
    if (expectedItems.rows.length !== actualItems.length ||
      expectedItems.rows.some((item, index) => item.item_key !== actualItems[index]?.itemKey ||
        item.target_reference !== actualItems[index]?.targetReference)) {
      throw new ConnectorTransferAuthorizationError()
    }
  }

  async refreshOperation(client: PoolClient, attempt: OutboundExecutionAttempt) {
    const counts = (await client.query<{
      total: number
      processed: number
      applied: number
      failed: number
      unknown: number
      cancel_requested: boolean
    }>(
      `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status <> 'pending')::int AS processed,
          count(*) FILTER (WHERE status IN ('applied','already-present','present'))::int AS applied,
          count(*) FILTER (WHERE status IN ('failed','absent'))::int AS failed,
          count(*) FILTER (WHERE status = 'outcome-unknown')::int AS unknown,
          (SELECT cancel_requested FROM transfers.operations WHERE id = $1::uuid) AS cancel_requested
       FROM transfers.operation_items WHERE operation_id = $1::uuid`,
      [attempt.operationId],
    )).rows[0]!
    const problem = attempt.problem ?? null
    const state = attempt.outcome === 'outcome-unknown' || counts.unknown > 0
      ? 'outcome-unknown'
      : attempt.final && counts.processed === counts.total && counts.failed === 0
        ? 'completed'
        : problem?.code === 'cancelled'
          ? 'cancelled'
          : problem?.actionRequired !== null && problem?.actionRequired !== undefined
            ? 'action-required'
            : problem !== null && !problem.retryable
              ? 'failed'
              : problem !== null || counts.failed > 0
                ? 'partial-failure'
                : counts.cancel_requested ? 'cancelled' : 'running'
    const stage = state === 'outcome-unknown'
      ? 'reconciling'
      : state === 'completed' || state === 'cancelled'
        ? 'externally-completed'
        : 'executing-provider-write'
    const at = this.now().toISOString()
    await client.query(
      `UPDATE transfers.operations SET state = $2, stage = $3, revision = revision + 1,
         total_count = $4, processed_count = $5, applied_count = $6, failed_count = $7,
         outcome_unknown_count = $8, action_required = $10,
         last_error_code = $11, last_error_retryable = $12, updated_at = $9::timestamptz,
         completed_at = CASE WHEN $2 IN ('completed','cancelled','failed')
           THEN $9::timestamptz ELSE NULL END
       WHERE id = $1::uuid`,
      [attempt.operationId, state, stage, counts.total, counts.processed, counts.applied,
        counts.failed, counts.unknown, at,
        state === 'action-required' ? problem!.actionRequired : null,
        problem?.code ?? null, problem?.retryable ?? null],
    )
    if (state === 'completed' || state === 'cancelled' || state === 'failed') {
      await client.query(
        `UPDATE transfers.outbound_transfers SET state = $2, revision = revision + 1,
           blocked_reason = CASE WHEN $2 = 'failed' THEN 'apply-failed' ELSE NULL END,
           updated_at = $3::timestamptz WHERE operation_id = $1::uuid`,
        [attempt.operationId, state, at],
      )
    }
  }

  async rejectGrant(
    client: PoolClient,
    commandId: string,
    code: 'not-found' | 'not-approvable' | 'revision-conflict',
  ): Promise<TransferCommandResult<OutboundExecutionGrant>> {
    await client.query('COMMIT')
    return { status: 'rejected', commandId, rejection: { code } }
  }
}
