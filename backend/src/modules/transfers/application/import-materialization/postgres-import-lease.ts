import type { Pool, PoolClient } from 'pg'

export type ClaimedImportOperation = Readonly<{
  id: string
  owner_membership_id: string
  resource_id: string
  attempt_count: number
  lease_generation: string
  created_at: Date
}>

export type ImportMaterializationResult =
  | 'idle'
  | 'completed'
  | 'blocked'
  | 'cancelled'
  | 'retry-scheduled'
  | 'lease-lost'

export class ImportMaterializationLeaseLostError extends Error {
  override readonly name = 'ImportMaterializationLeaseLostError'
}

type ClaimResult =
  | Readonly<{ kind: 'claimed'; operation: ClaimedImportOperation }>
  | Readonly<{ kind: 'cancelled' }>

export type ImportLeaseOptions = Readonly<{
  workerId: string
  leaseMilliseconds: number
  maximumBackoffMilliseconds: number
  now?: () => Date
}>

export class PostgresImportLease {
  constructor(
    private readonly pool: Pool,
    private readonly options: ImportLeaseOptions,
  ) {}

  get now() { return this.options.now ?? (() => new Date()) }
  get workerId() { return this.options.workerId }

  async claim(): Promise<ClaimResult | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const at = this.now()
      const row = (await client.query<ClaimedImportOperation>(
        `SELECT id, owner_membership_id, resource_id, attempt_count, created_at
         FROM transfers.operations
         WHERE kind = 'import-materialization'
           AND (
             state = 'queued'
             OR (state = 'retry-scheduled' AND next_attempt_at <= $1::timestamptz)
             OR (state = 'running' AND lease_expires_at <= $1::timestamptz)
           )
         ORDER BY coalesce(next_attempt_at, created_at), id
         FOR UPDATE SKIP LOCKED LIMIT 1`, [at.toISOString()],
      )).rows[0]
      if (row === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      if ((await client.query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM transfers.operations WHERE id = $1::uuid`, [row.id],
      )).rows[0]!.cancel_requested) {
        await client.query(
          `UPDATE transfers.import_plans SET state = 'cancelled', blocked_reason = NULL,
             revision = revision + 1, updated_at = $2::timestamptz WHERE id = $1::uuid`,
          [row.resource_id, at.toISOString()],
        )
        await client.query(
          `UPDATE transfers.operations SET state = 'cancelled', revision = revision + 1,
             lease_owner = NULL, lease_expires_at = NULL, completed_at = $2::timestamptz,
             updated_at = $2::timestamptz WHERE id = $1::uuid`, [row.id, at.toISOString()],
        )
        await client.query('COMMIT')
        return { kind: 'cancelled' }
      }
      const claimed = (await client.query<ClaimedImportOperation>(
        `UPDATE transfers.operations SET state = 'running', stage = 'materializing',
           revision = revision + 1, attempt_count = attempt_count + 1,
           lease_generation = lease_generation + 1,
           lease_owner = $2, lease_expires_at = $3::timestamptz, next_attempt_at = NULL,
           last_error_code = NULL, last_error_retryable = NULL, updated_at = $4::timestamptz
         WHERE id = $1::uuid
         RETURNING id, owner_membership_id, resource_id, attempt_count,
                   lease_generation::text, created_at`,
        [row.id, this.options.workerId,
          new Date(at.getTime() + this.options.leaseMilliseconds).toISOString(), at.toISOString()],
      )).rows[0]
      if (claimed === undefined) throw new ImportMaterializationLeaseLostError()
      await client.query(
        `UPDATE transfers.import_plan_mappings SET materialization_state = 'pending',
           rejection_code = NULL WHERE plan_id = $1::uuid AND materialization_state = 'rejected'`,
        [row.resource_id],
      )
      await client.query('COMMIT')
      return { kind: 'claimed', operation: claimed }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async state(operation: ClaimedImportOperation): Promise<'active' | 'cancel-requested' | 'lost'> {
    const row = (await this.pool.query<{ cancel_requested: boolean }>(
      `SELECT cancel_requested FROM transfers.operations
       WHERE id = $1::uuid AND state = 'running' AND lease_owner = $2
         AND lease_generation = $3::bigint`,
      [operation.id, this.options.workerId, operation.lease_generation],
    )).rows[0]
    return row === undefined ? 'lost' : row.cancel_requested ? 'cancel-requested' : 'active'
  }

  async lock(client: Pick<PoolClient, 'query'>, operation: ClaimedImportOperation) {
    const row = (await client.query<{ cancel_requested: boolean }>(
      `SELECT cancel_requested FROM transfers.operations
       WHERE id = $1::uuid AND state = 'running' AND lease_owner = $2
         AND lease_generation = $3::bigint FOR UPDATE`,
      [operation.id, this.options.workerId, operation.lease_generation],
    )).rows[0]
    if (row === undefined) throw new ImportMaterializationLeaseLostError()
    return row.cancel_requested
  }

  async acknowledgeCancel(operation: ClaimedImportOperation) {
    const at = this.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lock(client, operation)
      await this.finishCancellation(client, operation, at)
      await client.query('COMMIT')
      return 'cancelled' as const
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async finishCancellation(
    client: Pick<PoolClient, 'query'>,
    operation: ClaimedImportOperation,
    at: string,
  ) {
    await client.query(
      `UPDATE transfers.import_plans SET state = 'cancelled', blocked_reason = NULL,
         revision = revision + 1, updated_at = $2::timestamptz WHERE operation_id = $1::uuid`,
      [operation.id, at],
    )
    const result = await client.query(
      `UPDATE transfers.operations SET state = 'cancelled', revision = revision + 1,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = $2::timestamptz,
         completed_at = $2::timestamptz
       WHERE id = $1::uuid AND state = 'running' AND lease_owner = $3
         AND lease_generation = $4::bigint`,
      [operation.id, at, this.options.workerId, operation.lease_generation],
    )
    if (result.rowCount !== 1) throw new ImportMaterializationLeaseLostError()
  }

  async recordFailure(operation: ClaimedImportOperation, error: unknown, retryable: boolean) {
    const at = this.now()
    const backoff = Math.min(this.options.maximumBackoffMilliseconds,
      1000 * (2 ** Math.min(operation.attempt_count, 10)))
    const code = error instanceof Error ? error.name.slice(0, 120) : 'unknown-error'
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const cancelled = await this.lock(client, operation)
      if (cancelled) {
        await this.finishCancellation(client, operation, at.toISOString())
        await client.query('COMMIT')
        return
      }
      if (!retryable) {
        await client.query(
          `UPDATE transfers.import_plans SET state = 'blocked',
             blocked_reason = 'materialization-rejected', revision = revision + 1,
             updated_at = $2::timestamptz WHERE id = $1::uuid`,
          [operation.resource_id, at.toISOString()],
        )
      }
      await client.query(
        `UPDATE transfers.operations SET state = $2, revision = revision + 1,
         lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = $3::timestamptz,
         last_error_code = $4, last_error_retryable = $5, updated_at = $6::timestamptz,
         completed_at = CASE WHEN $2 = 'failed' THEN $6::timestamptz ELSE NULL END
       WHERE id = $1::uuid AND lease_owner = $7
         AND lease_generation = $8::bigint AND state = 'running'`,
        [operation.id, retryable ? 'retry-scheduled' : 'failed',
        retryable ? new Date(at.getTime() + backoff).toISOString() : null,
        code, retryable, at.toISOString(), this.options.workerId, operation.lease_generation],
      )
      await client.query('COMMIT')
    } catch (nested) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw nested
    } finally { client.release() }
  }

  async withHeartbeat<Value>(operation: ClaimedImportOperation, run: () => Promise<Value>) {
    const intervalMilliseconds = Math.max(100, Math.floor(this.options.leaseMilliseconds / 3))
    let heartbeatFailure: unknown
    let heartbeat = Promise.resolve()
    const timer = setInterval(() => {
      heartbeat = heartbeat.then(() => this.heartbeat(operation)).catch((error: unknown) => {
        heartbeatFailure = error
      })
    }, intervalMilliseconds)
    timer.unref()
    try {
      const value = await run()
      clearInterval(timer)
      await heartbeat
      if (heartbeatFailure !== undefined) throw heartbeatFailure
      return value
    } finally {
      clearInterval(timer)
    }
  }

  private async heartbeat(operation: ClaimedImportOperation) {
    const at = this.now()
    const result = await this.pool.query(
      `UPDATE transfers.operations SET lease_expires_at = $4::timestamptz
       WHERE id = $1::uuid AND state = 'running' AND lease_owner = $2
         AND lease_generation = $3::bigint`,
      [operation.id, this.options.workerId, operation.lease_generation,
        new Date(at.getTime() + this.options.leaseMilliseconds).toISOString()],
    )
    if (result.rowCount !== 1) throw new ImportMaterializationLeaseLostError()
  }
}
