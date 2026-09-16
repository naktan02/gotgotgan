import type { Pool, PoolClient } from 'pg'

import {
  deterministicOperationId,
  operationVersion,
  readOpaqueRevision,
  transferFingerprint,
} from '../../application/identity.js'
import { InvalidTransferCursorError, type TransferCommandResult } from '../../domain/model.js'
import type {
  TransferOperation,
  TransferOperationAction,
  TransferOperationItem,
  TransferOperationKind,
  TransferOperationQueries,
  TransferOperationState,
} from '../../domain/operations.js'

type OperationRow = Readonly<{
  id: string; kind: TransferOperationKind; provider_key: TransferOperation['providerKey']
  connection_id: string | null; account_label: string | null
  resource_kind: TransferOperation['resource']['kind']; resource_id: string | null
  stage: TransferOperation['stage']; state: TransferOperationState; revision: string
  total_count: number; processed_count: number; applied_count: number; failed_count: number
  outcome_unknown_count: number; attempt_count: number; next_attempt_at: Date | null
  cancel_requested: boolean
  action_required: TransferOperation['actionRequired']; last_error_code: string | null
  last_error_retryable: boolean | null; created_at: Date; updated_at: Date; completed_at: Date | null
}>

function allowedActions(row: OperationRow): readonly TransferOperationAction[] {
  if (row.kind === 'account-erasure') return []
  if (row.state === 'outcome-unknown') return ['reconcile']
  if (row.cancel_requested) return []
  if (row.state === 'queued' || row.state === 'running' || row.state === 'retry-scheduled') {
    return ['cancel']
  }
  if (row.state === 'action-required' || row.state === 'partial-failure') {
    // A provider-side partial result invalidates the approved outbound observation. A fresh preview
    // is required; replaying the full approved batch could duplicate provider writes.
    return row.kind === 'outbound-transfer' ? ['cancel'] : ['resume', 'cancel']
  }
  if (row.state === 'failed' && row.last_error_retryable === true) {
    return row.kind === 'outbound-transfer' ? [] : ['retry']
  }
  return []
}

function project(row: OperationRow): TransferOperation {
  const resource = row.resource_kind === 'snapshot'
    ? { kind: 'snapshot' as const, snapshotId: row.resource_id! }
    : row.resource_kind === 'import-plan'
      ? { kind: 'import-plan' as const, planId: row.resource_id! }
      : row.resource_kind === 'outbound-transfer'
        ? { kind: 'outbound-transfer' as const, transferId: row.resource_id! }
        : { kind: 'membership-erasure' as const }
  return {
    schemaVersion: 'transfer-operation.v2', operationId: row.id, kind: row.kind,
    providerKey: row.provider_key, connectionId: row.connection_id, accountLabel: row.account_label,
    resource, stage: row.stage, state: row.state,
    progress: {
      total: row.total_count, processed: row.processed_count, applied: row.applied_count,
      failed: row.failed_count, outcomeUnknown: row.outcome_unknown_count,
    },
    operationRevision: operationVersion(row.id, row.revision), attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null, actionRequired: row.action_required,
    allowedActions: allowedActions(row),
    lastError: row.last_error_code === null ? null : {
      code: row.last_error_code, retryable: row.last_error_retryable!,
    },
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}

const operationColumns = `id, kind, provider_key, connection_id, account_label, resource_kind,
  resource_id, stage, state, revision::text, total_count, processed_count, applied_count,
  failed_count, outcome_unknown_count, attempt_count, next_attempt_at, action_required,
  last_error_code, last_error_retryable, cancel_requested, created_at, updated_at, completed_at`

function encodeCursor(row: OperationRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at.toISOString(), id: row.id }), 'utf8')
    .toString('base64url')
}

function decodeCursor(value: string | undefined): { updatedAt: string; id: string } | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string') throw new Error()
    if (!Number.isFinite(Date.parse(parsed.updatedAt))) throw new Error()
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw new InvalidTransferCursorError('Transfer operation cursor is invalid')
  }
}

export class PostgresTransferOperations implements TransferOperationQueries {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}

  async list(input: Readonly<{
    memberId: string; kind?: TransferOperationKind; state?: TransferOperationState
    cursor?: string; limit: number
  }>) {
    const page = decodeCursor(input.cursor)
    const rows = await this.pool.query<OperationRow>(
      `SELECT ${operationColumns} FROM transfers.operations
       WHERE owner_membership_id = $1::uuid
         AND ($2::text IS NULL OR kind = $2)
         AND ($3::text IS NULL OR state = $3)
         AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::uuid))
       ORDER BY updated_at DESC, id DESC LIMIT $6`,
      [input.memberId, input.kind ?? null, input.state ?? null, page?.updatedAt ?? null,
        page?.id ?? null, input.limit + 1],
    )
    const visible = rows.rows.slice(0, input.limit)
    return {
      items: visible.map(project),
      ...(rows.rows.length > input.limit ? { nextCursor: encodeCursor(visible.at(-1)!) } : {}),
    }
  }

  async summary(memberId: string) {
    const [counts, latest] = await Promise.all([
      this.pool.query<{
        active: number; attention: number; action_required: number; outcome_unknown: number
      }>(
        `SELECT
           count(*) FILTER (WHERE state IN ('queued','running','retry-scheduled'))::int AS active,
           count(*) FILTER (WHERE state IN (
             'action-required','partial-failure','failed','outcome-unknown'
           ))::int AS attention,
           count(*) FILTER (WHERE state IN ('action-required','partial-failure'))::int AS action_required,
           count(*) FILTER (WHERE state = 'outcome-unknown')::int AS outcome_unknown
         FROM transfers.operations WHERE owner_membership_id = $1::uuid`, [memberId],
      ),
      this.pool.query<OperationRow>(
        `SELECT ${operationColumns} FROM transfers.operations
         WHERE owner_membership_id = $1::uuid ORDER BY updated_at DESC, id DESC LIMIT 5`, [memberId],
      ),
    ])
    const count = counts.rows[0]!
    return {
      activeCount: count.active, attentionCount: count.attention,
      actionRequiredCount: count.action_required,
      outcomeUnknownCount: count.outcome_unknown, latest: latest.rows.map(project),
    }
  }

  async get(memberId: string, operationId: string) {
    const row = (await this.pool.query<OperationRow>(
      `SELECT ${operationColumns} FROM transfers.operations
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`, [operationId, memberId],
    )).rows[0]
    return row === undefined ? undefined : project(row)
  }

  async items(input: Readonly<{
    memberId: string; operationId: string; cursor?: string; limit: number
  }>) {
    const exists = (await this.pool.query(
      `SELECT 1 FROM transfers.operations WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [input.operationId, input.memberId],
    )).rowCount !== 0
    if (!exists) return undefined
    const after = input.cursor === undefined ? undefined : Number.parseInt(
      Buffer.from(input.cursor, 'base64url').toString('utf8'), 10,
    )
    if (after !== undefined && (!Number.isInteger(after) || after < 0)) {
      throw new InvalidTransferCursorError('Transfer operation item cursor is invalid')
    }
    const result = await this.pool.query<{
      item_key: string; canonical_place_id: string | null; target_reference: string | null
      status: TransferOperationItem['status']; code: string | null; retryable: boolean | null
      source_position: number; updated_at: Date
    }>(
      `SELECT item_key, canonical_place_id, target_reference, status, code, retryable,
              source_position, updated_at FROM transfers.operation_items
       WHERE operation_id = $1::uuid AND ($2::int IS NULL OR source_position > $2)
       ORDER BY source_position, item_key LIMIT $3`,
      [input.operationId, after ?? null, input.limit + 1],
    )
    const visible = result.rows.slice(0, input.limit)
    return {
      items: visible.map((row) => ({
        itemKey: row.item_key, placeId: row.canonical_place_id,
        targetReference: row.target_reference, status: row.status, code: row.code,
        retryable: row.retryable, updatedAt: row.updated_at.toISOString(),
      })),
      ...(result.rows.length > input.limit ? {
        nextCursor: Buffer.from(String(visible.at(-1)!.source_position), 'utf8').toString('base64url'),
      } : {}),
    }
  }

  async command(memberId: string, command: Readonly<{
    commandId: string; operationId: string; expectedOperationRevision: string
    action: TransferOperationAction
  }>): Promise<TransferCommandResult<TransferOperation>> {
    const kind = 'transfer-operation-command'
    const fingerprint = transferFingerprint({ memberId, command })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.transfer-command:' || $1,0))",
        [command.commandId],
      )
      const prior = (await client.query<{
        owner_membership_id: string; command_kind: string; command_fingerprint: string
        status: string; result: Record<string, unknown>
      }>(`SELECT owner_membership_id, command_kind, command_fingerprint, status, result
          FROM transfers.command_receipts WHERE command_id = $1::uuid`, [command.commandId])).rows[0]
      if (prior !== undefined) {
        if (prior.owner_membership_id !== memberId || prior.command_kind !== kind ||
          prior.command_fingerprint !== fingerprint) {
          await client.query('COMMIT')
          return { status: 'rejected', commandId: command.commandId,
            rejection: { code: 'command-id-reused' } }
        }
        if (prior.status === 'rejected') {
          const rejection = (prior.result.rejection ?? {}) as Record<string, unknown>
          const code = typeof rejection.code === 'string' ? rejection.code : 'not-approvable'
          await client.query('COMMIT')
          return { status: 'rejected', commandId: command.commandId,
            rejection: { code: code as 'not-approvable' } }
        }
        const replayed = await this.getWithClient(client, memberId, command.operationId)
        await client.query('COMMIT')
        return replayed === undefined
          ? { status: 'rejected', commandId: command.commandId, rejection: { code: 'not-found' } }
          : { status: 'replayed', commandId: command.commandId, value: replayed }
      }
      const row = (await client.query<OperationRow>(
        `SELECT ${operationColumns} FROM transfers.operations
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [command.operationId, memberId],
      )).rows[0]
      if (row === undefined) return await this.reject(client, memberId, command, kind, fingerprint, 'not-found')
      if (readOpaqueRevision('transfer-operation', command.expectedOperationRevision, row.id) !== row.revision) {
        return await this.reject(client, memberId, command, kind, fingerprint, 'revision-conflict')
      }
      if (!allowedActions(row).includes(command.action)) {
        return await this.reject(client, memberId, command, kind, fingerprint, 'not-approvable')
      }
      const at = this.now().toISOString()
      const deferredCancellation = command.action === 'cancel' && row.state === 'running' &&
        (row.kind === 'import-materialization' || row.kind === 'outbound-transfer')
      const transition = command.action === 'cancel' && !deferredCancellation
        ? { state: 'cancelled', stage: row.stage, completed: at }
        : command.action === 'reconcile'
          ? { state: 'outcome-unknown', stage: 'reconciling' as const, completed: null }
          : { state: 'queued', stage: row.stage, completed: null }
      await client.query(
        `UPDATE transfers.operations SET state = $3, stage = $4, revision = revision + 1,
           next_attempt_at = NULL, action_required = NULL, last_error_code = NULL,
           last_error_retryable = NULL, cancel_requested = $5, updated_at = $6::timestamptz,
           completed_at = $7::timestamptz WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [row.id, memberId, deferredCancellation ? row.state : transition.state, transition.stage,
          command.action === 'cancel', at,
          transition.completed],
      )
      if (row.kind === 'import-materialization' && command.action !== 'cancel') {
        await client.query(
          `UPDATE transfers.import_plans SET state = 'applying', blocked_reason = NULL,
             revision = revision + 1, updated_at = $3::timestamptz
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
          [row.resource_id, memberId, at],
        )
      }
      if (command.action === 'cancel') {
        await client.query(
          `UPDATE transfers.connector_import_grants SET status = 'revoked'
           WHERE operation_id = $1::uuid AND status = 'active'`, [row.id],
        )
        await client.query(
          `UPDATE transfers.outbound_execution_grants SET status = 'revoked'
           WHERE operation_id = $1::uuid AND status = 'issued'`, [row.id],
        )
        if (!deferredCancellation) {
          if (row.resource_kind === 'snapshot') {
            await client.query(
              `UPDATE transfers.connector_capture_manifests SET status = 'cancelled'
               WHERE operation_id = $1::uuid AND status = 'receiving'`, [row.id],
            )
          } else if (row.resource_kind === 'import-plan') {
            await client.query(
              `UPDATE transfers.import_plans SET state = 'cancelled', blocked_reason = NULL,
                 revision = revision + 1, updated_at = $2::timestamptz
               WHERE operation_id = $1::uuid`, [row.id, at],
            )
          } else if (row.resource_kind === 'outbound-transfer') {
            await client.query(
              `UPDATE transfers.outbound_transfers SET state = 'cancelled', blocked_reason = NULL,
                 revision = revision + 1, updated_at = $2::timestamptz
               WHERE operation_id = $1::uuid`, [row.id, at],
            )
          }
        }
      }
      await client.query(
        `INSERT INTO transfers.command_receipts (command_id, owner_membership_id, command_kind,
           command_fingerprint, status, result, created_at, completed_at)
         VALUES ($1::uuid,$2::uuid,$3,$4,'accepted',$5::jsonb,$6::timestamptz,$6::timestamptz)`,
        [command.commandId, memberId, kind, fingerprint,
          JSON.stringify({ reference: { kind: 'operation', id: row.id } }), at],
      )
      const value = (await this.getWithClient(client, memberId, row.id))!
      await client.query('COMMIT')
      return { status: 'applied', commandId: command.commandId, value }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async planAccountErasure(memberId: string, commandId: string) {
    const kind = 'account-erasure-review'
    const fingerprint = transferFingerprint({ memberId, commandId, kind })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.operation-command:' || $1,0))",
        [commandId],
      )
      const prior = (await client.query<{
        owner_membership_id: string; command_kind: string; command_fingerprint: string
        status: 'accepted' | 'rejected' | 'pending'; result: Record<string, unknown>
      }>(`SELECT owner_membership_id, command_kind, command_fingerprint, status, result
           FROM transfers.command_receipts WHERE command_id = $1::uuid`, [commandId])).rows[0]
      if (prior !== undefined) {
        if (prior.owner_membership_id !== memberId || prior.command_kind !== kind ||
          prior.command_fingerprint !== fingerprint) {
          await client.query('COMMIT')
          return { status: 'rejected' as const, commandId,
            rejection: { code: 'command-id-reused' as const } }
        }
        const reference = prior.result.reference as { id?: unknown } | undefined
        const plan = prior.result.plan as {
          physicalDeletionPerformed: false; retentionDisposition: 'operator-review-required'
          recordCounts: { providerConnections: number; sourceSnapshots: number; importPlans: number
            outboundTransfers: number; transferOperations: number }
        } | undefined
        if (prior.status !== 'accepted' || typeof reference?.id !== 'string' || plan === undefined) {
          await client.query('COMMIT')
          return { status: 'rejected' as const, commandId,
            rejection: { code: 'not-approvable' as const } }
        }
        const operation = await this.getWithClient(client, memberId, reference.id)
        if (operation === undefined) throw new Error('account erasure review operation is missing')
        await client.query('COMMIT')
        return { status: 'replayed' as const, commandId, value: { operation, plan } }
      }
      const at = this.now().toISOString()
      const operationId = deterministicOperationId('account-erasure-review', memberId, commandId)
      await client.query(
        `INSERT INTO transfers.operations (
           id, owner_membership_id, kind, resource_kind, stage, state, action_required,
           created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,'account-erasure','membership-erasure','retention-review',
           'action-required','retention-review-required',$3::timestamptz,$3::timestamptz)`,
        [operationId, memberId, at],
      )
      const counts = (await client.query<{
        provider_connections: number; source_snapshots: number; import_plans: number
        outbound_transfers: number; transfer_operations: number
      }>(`SELECT
          (SELECT count(*)::int FROM transfers.provider_connections WHERE owner_membership_id=$1::uuid)
            AS provider_connections,
          (SELECT count(*)::int FROM transfers.source_snapshots WHERE owner_membership_id=$1::uuid)
            AS source_snapshots,
          (SELECT count(*)::int FROM transfers.import_plans WHERE owner_membership_id=$1::uuid)
            AS import_plans,
          (SELECT count(*)::int FROM transfers.outbound_transfers WHERE owner_membership_id=$1::uuid)
            AS outbound_transfers,
          (SELECT count(*)::int FROM transfers.operations WHERE owner_membership_id=$1::uuid)
            AS transfer_operations`, [memberId])).rows[0]!
      const plan = {
        physicalDeletionPerformed: false as const,
        retentionDisposition: 'operator-review-required' as const,
        recordCounts: {
          providerConnections: counts.provider_connections,
          sourceSnapshots: counts.source_snapshots,
          importPlans: counts.import_plans,
          outboundTransfers: counts.outbound_transfers,
          transferOperations: counts.transfer_operations,
        },
      }
      await client.query(
        `INSERT INTO transfers.command_receipts (
           command_id, owner_membership_id, command_kind, command_fingerprint,
           status, result, created_at, completed_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'accepted',$5::jsonb,$6::timestamptz,$6::timestamptz)`,
        [commandId, memberId, kind, fingerprint,
          JSON.stringify({ reference: { kind: 'operation', id: operationId }, plan }), at],
      )
      const operation = (await this.getWithClient(client, memberId, operationId))!
      await client.query('COMMIT')
      return { status: 'applied' as const, commandId, value: { operation, plan } }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  private async getWithClient(client: Pick<PoolClient, 'query'>, memberId: string, id: string) {
    const row = (await client.query<OperationRow>(
      `SELECT ${operationColumns} FROM transfers.operations
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`, [id, memberId],
    )).rows[0]
    return row === undefined ? undefined : project(row)
  }

  private async reject(
    client: PoolClient, memberId: string,
    command: Readonly<{ commandId: string }>, kind: string, fingerprint: string,
    code: 'not-found' | 'revision-conflict' | 'not-approvable',
  ): Promise<TransferCommandResult<TransferOperation>> {
    const at = this.now().toISOString()
    await client.query(
      `INSERT INTO transfers.command_receipts (command_id, owner_membership_id, command_kind,
         command_fingerprint, status, result, created_at, completed_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,'rejected',$5::jsonb,$6::timestamptz,$6::timestamptz)`,
      [command.commandId, memberId, kind, fingerprint, JSON.stringify({ rejection: { code } }), at],
    )
    await client.query('COMMIT')
    return { status: 'rejected', commandId: command.commandId, rejection: { code } }
  }
}
