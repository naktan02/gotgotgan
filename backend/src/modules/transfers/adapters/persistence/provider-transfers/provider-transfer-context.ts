import type { Pool, PoolClient } from 'pg'

import { connectionVersion, transferFingerprint } from '../../../application/identity.js'
import type {
  CollectionTransferReader,
  ProviderConnectionV2,
  SavedPlaceSource,
  SavedPlaceTarget,
  TransferCommandResult,
  TransferCommandRejectionCodeV2,
} from '../../../domain/model.js'

export type ProviderKey = 'naver' | 'kakao' | 'google'

export type ReceiptReference = Readonly<{
  kind: 'import-plan' | 'outbound-transfer'
  id: string
  acceptedRevision: string
}>

type ReceiptRow = Readonly<{
  owner_membership_id: string
  command_kind: string
  command_fingerprint: string
  status: 'pending' | 'accepted' | 'rejected'
  result: Record<string, unknown>
}>

export type ConnectionRow = Readonly<{
  id: string
  provider_key: ProviderKey
  label: string
  auth_method: ProviderConnectionV2['authMethod']
  state: ProviderConnectionV2['state']
  action_required: ProviderConnectionV2['actionRequired']
  revision: string
  last_verified_at: Date | null
  created_at: Date
  updated_at: Date
}>

export type ProviderTransferOptions = Readonly<{
  pool: Pool
  collections: CollectionTransferReader
  enabledConnectionAuthMethods?: Readonly<Partial<
    Record<ProviderKey, readonly ProviderConnectionV2['authMethod'][]>
  >>
  sources?: readonly SavedPlaceSource[]
  targets?: readonly SavedPlaceTarget[]
  now?: () => Date
}>

export const providerOrder: readonly ProviderKey[] = ['naver', 'google', 'kakao']
export const displayNames: Readonly<Record<ProviderKey, string>> = {
  naver: 'NAVER',
  google: 'Google',
  kakao: 'Kakao',
}
export const authMethods: Readonly<
  Record<ProviderKey, readonly ProviderConnectionV2['authMethod'][]>
> = {
  naver: ['browser-session', 'managed-profile', 'account-export', 'manual-file'],
  google: ['account-export', 'manual-file'],
  kakao: ['account-export', 'manual-file'],
}

export function projectConnection(
  row: ConnectionRow,
  accountFingerprint?: string | null,
): ProviderConnectionV2 {
  const requiresVerifiedFingerprint = row.state === 'ready' && accountFingerprint === null
  return {
    schemaVersion: 'provider-connection.v2',
    connectionId: row.id,
    providerKey: row.provider_key,
    label: row.label,
    authMethod: row.auth_method,
    state: requiresVerifiedFingerprint ? 'action-required' : row.state,
    connectionRevision: connectionVersion(row.id, row.revision),
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    actionRequired: requiresVerifiedFingerprint ? 'reauthorize' : row.action_required,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export function rejection<Value>(
  commandId: string,
  code: TransferCommandRejectionCodeV2,
): TransferCommandResult<Value> {
  return { status: 'rejected', commandId, rejection: { code } }
}

export class ProviderTransferContext {
  readonly pool: Pool
  readonly collections: CollectionTransferReader
  readonly enabledConnectionAuthMethods: ReadonlyMap<
    ProviderKey,
    ReadonlySet<ProviderConnectionV2['authMethod']>
  >
  readonly sources: ReadonlyMap<ProviderKey, SavedPlaceSource>
  readonly targets: ReadonlyMap<ProviderKey, SavedPlaceTarget>
  readonly now: () => Date

  constructor(options: ProviderTransferOptions) {
    this.pool = options.pool
    this.collections = options.collections
    this.enabledConnectionAuthMethods = new Map(providerOrder.map((providerKey) => [
      providerKey,
      new Set(options.enabledConnectionAuthMethods?.[providerKey] ?? []),
    ]))
    this.sources = new Map((options.sources ?? []).map((source) => [source.providerKey, source]))
    this.targets = new Map((options.targets ?? []).map((target) => [target.providerKey, target]))
    this.now = options.now ?? (() => new Date())
  }

  async lockCommand(client: PoolClient, commandId: string): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.transfers.v2:' || $1, 0))",
      [commandId],
    )
  }

  async prior<Value>(
    client: PoolClient,
    input: Readonly<{
      commandId: string
      memberId: string
      kind: string
      fingerprint: string
    }>,
    resolveReference?: (
      reference: ReceiptReference,
      client: Pick<PoolClient, 'query'>,
    ) => Promise<Value | undefined>,
  ): Promise<TransferCommandResult<Value> | 'pending' | undefined> {
    const row = (await client.query<ReceiptRow>(
      `SELECT owner_membership_id, command_kind, command_fingerprint, status, result
       FROM transfers.command_receipts WHERE command_id = $1::uuid`,
      [input.commandId],
    )).rows[0]
    if (row === undefined) return undefined
    if (row.owner_membership_id !== input.memberId || row.command_kind !== input.kind ||
      row.command_fingerprint !== input.fingerprint) {
      return rejection(input.commandId, 'command-id-reused')
    }
    if (row.status === 'pending') return 'pending'
    if (row.status === 'accepted') {
      const reference = row.result.reference as Partial<ReceiptReference> | undefined
      if (reference !== undefined &&
        (reference.kind === 'import-plan' || reference.kind === 'outbound-transfer') &&
        typeof reference.id === 'string' && typeof reference.acceptedRevision === 'string') {
        if (resolveReference === undefined) {
          throw new Error('accepted transfer receipt reference resolver is unavailable')
        }
        const value = await resolveReference(reference as ReceiptReference, client)
        if (value === undefined) throw new Error('accepted transfer receipt target is unavailable')
        return { status: 'replayed', commandId: input.commandId, value }
      }
      return {
        status: 'replayed',
        commandId: input.commandId,
        value: row.result.value as Value,
      }
    }
    return rejection(
      input.commandId,
      (row.result.rejection as { code: TransferCommandRejectionCodeV2 }).code,
    )
  }

  async recordRejected<Value>(
    client: PoolClient,
    input: Readonly<{
      commandId: string
      memberId: string
      kind: string
      fingerprint: string
      code: TransferCommandRejectionCodeV2
      at: string
    }>,
  ): Promise<TransferCommandResult<Value>> {
    await client.query(
      `INSERT INTO transfers.command_receipts (
         command_id, owner_membership_id, command_kind, command_fingerprint,
         status, result, created_at, completed_at
       ) VALUES ($1::uuid,$2::uuid,$3,$4,'rejected',$5::jsonb,$6::timestamptz,$6::timestamptz)`,
      [input.commandId, input.memberId, input.kind, input.fingerprint,
        JSON.stringify({ rejection: { code: input.code } }), input.at],
    )
    return rejection(input.commandId, input.code)
  }

  async recordAccepted<Value>(
    client: PoolClient,
    input: Readonly<{
      commandId: string
      memberId: string
      kind: string
      fingerprint: string
      value: Value
      at: string
      reference?: ReceiptReference
    }>,
  ): Promise<TransferCommandResult<Value>> {
    await client.query(
      `INSERT INTO transfers.command_receipts (
         command_id, owner_membership_id, command_kind, command_fingerprint,
         status, result, created_at, completed_at
      ) VALUES ($1::uuid,$2::uuid,$3,$4,'accepted',$5::jsonb,$6::timestamptz,$6::timestamptz)`,
      [input.commandId, input.memberId, input.kind, input.fingerprint,
        JSON.stringify(input.reference === undefined
          ? { value: input.value }
          : { reference: input.reference }), input.at],
    )
    return { status: 'applied', commandId: input.commandId, value: input.value }
  }

  async rejectStandalone<Value>(input: Readonly<{
    commandId: string
    memberId: string
    kind: string
    fingerprint: string
    code: TransferCommandRejectionCodeV2
    at: string
    resolveReference?: (
      reference: ReceiptReference,
      client: Pick<PoolClient, 'query'>,
    ) => Promise<Value | undefined>
  }>): Promise<TransferCommandResult<Value>> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, input.commandId)
      const prior = await this.prior<Value>(client, input, input.resolveReference)
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const result = await this.recordRejected<Value>(client, input)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async rejectInTransaction<Value>(
    client: PoolClient,
    input: Readonly<{
      commandId: string
      memberId: string
      kind: string
      fingerprint: string
      code: TransferCommandRejectionCodeV2
      at: string
    }>,
  ): Promise<TransferCommandResult<Value>> {
    const result = await this.recordRejected<Value>(client, input)
    await client.query('COMMIT')
    return result
  }

  fingerprint(input: unknown): string {
    return transferFingerprint(input)
  }
}
