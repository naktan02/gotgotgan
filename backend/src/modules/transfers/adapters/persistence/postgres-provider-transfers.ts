import type { Pool, PoolClient } from 'pg'
import {
  connectionVersion,
  deterministicOperationId,
  outboundVersion,
  planVersion,
  readOpaqueRevision,
  snapshotVersion,
  transferFingerprint,
} from '../../application/identity.js'
import { InvalidTransferCursorError } from '../../domain/model.js'
import type {
  CollectionTransferReader,
  ImportPlanCommandRequestV2,
  ImportPlanV2,
  ImportedCollectionMaterializerPort,
  OutboundTransferCommandRequestV2,
  OutboundTransferV2,
  ProviderCapabilityV2,
  ProviderConnectionObservation,
  ProviderConnectionCommandRequestV2,
  ProviderConnectionV2,
  ProviderTransfers,
  SavedPlaceSource,
  SavedPlaceTarget,
  SnapshotItem,
  SourceSnapshotDetailV2,
  SourceSnapshotListV2,
  SourceSnapshotCapture,
  TransferCommandResult,
  TransferCommandRejectionCodeV2,
  TrustedProviderTransferObservations,
} from '../../domain/model.js'

type ProviderKey = 'naver' | 'kakao' | 'google'
type ReceiptRow = Readonly<{
  owner_membership_id: string
  command_kind: string
  command_fingerprint: string
  status: 'pending' | 'accepted' | 'rejected'
  result: Record<string, unknown>
}>
type ReceiptReference = Readonly<{
  kind: 'import-plan' | 'outbound-transfer'
  id: string
  acceptedRevision: string
}>
type ConnectionRow = Readonly<{
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

const providerOrder: readonly ProviderKey[] = ['naver', 'google', 'kakao']
const displayNames: Readonly<Record<ProviderKey, string>> = {
  naver: 'NAVER', google: 'Google', kakao: 'Kakao',
}
const authMethods: Readonly<Record<ProviderKey, readonly ProviderConnectionV2['authMethod'][]>> = {
  naver: ['browser-session', 'managed-profile', 'account-export', 'manual-file'],
  google: ['account-export', 'manual-file'],
  kakao: ['account-export', 'manual-file'],
}

function connectionProjection(row: ConnectionRow): ProviderConnectionV2 {
  return {
    schemaVersion: 'provider-connection.v2',
    connectionId: row.id,
    providerKey: row.provider_key,
    label: row.label,
    authMethod: row.auth_method,
    state: row.state,
    connectionRevision: connectionVersion(row.id, row.revision),
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    actionRequired: row.action_required,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function rejection<Value>(
  commandId: string,
  code: TransferCommandRejectionCodeV2,
): TransferCommandResult<Value> {
  return { status: 'rejected', commandId, rejection: { code } }
}

function cursor(input: Readonly<{ capturedAt: string; snapshotId: string }>): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')
}

function readCursor(value: string | undefined) {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.capturedAt !== 'string' || typeof parsed.snapshotId !== 'string') return undefined
    return { capturedAt: parsed.capturedAt, snapshotId: parsed.snapshotId }
  } catch {
    return undefined
  }
}

type Options = Readonly<{
  pool: Pool
  materializer: ImportedCollectionMaterializerPort
  collections: CollectionTransferReader
  enabledConnectionAuthMethods?: Readonly<Partial<
    Record<ProviderKey, readonly ProviderConnectionV2['authMethod'][]>
  >>
  sources?: readonly SavedPlaceSource[]
  targets?: readonly SavedPlaceTarget[]
  now?: () => Date
}>

export class PostgresProviderTransfers
implements ProviderTransfers, TrustedProviderTransferObservations {
  private readonly pool: Pool
  private readonly materializer: ImportedCollectionMaterializerPort
  private readonly collections: CollectionTransferReader
  private readonly enabledConnectionAuthMethods: ReadonlyMap<
    ProviderKey, ReadonlySet<ProviderConnectionV2['authMethod']>
  >
  private readonly sources: ReadonlyMap<ProviderKey, SavedPlaceSource>
  private readonly targets: ReadonlyMap<ProviderKey, SavedPlaceTarget>
  private readonly now: () => Date

  constructor(options: Options) {
    this.pool = options.pool
    this.materializer = options.materializer
    this.collections = options.collections
    this.enabledConnectionAuthMethods = new Map(providerOrder.map((providerKey) => [
      providerKey,
      new Set(options.enabledConnectionAuthMethods?.[providerKey] ?? []),
    ]))
    this.sources = new Map((options.sources ?? []).map((source) => [source.providerKey, source]))
    this.targets = new Map((options.targets ?? []).map((target) => [target.providerKey, target]))
    this.now = options.now ?? (() => new Date())
  }

  async listCapabilities(): Promise<readonly ProviderCapabilityV2[]> {
    return providerOrder.map((providerKey) => ({
      providerKey,
      displayName: displayNames[providerKey],
      connections: (this.enabledConnectionAuthMethods.get(providerKey)?.size ?? 0) > 0
        ? {
            availability: 'available', multipleAccounts: true,
            authMethods: [...this.enabledConnectionAuthMethods.get(providerKey)!],
          }
        : providerKey === 'naver'
          ? { availability: 'integration-gated', multipleAccounts: true, authMethods: [...authMethods.naver] }
          : { availability: 'unavailable', multipleAccounts: true, authMethods: [] },
      importSavedPlaces: this.sources.has(providerKey)
        ? { availability: 'available' }
        : providerKey === 'naver'
          ? { availability: 'integration-gated', reason: 'source-adapter-unavailable' }
          : { availability: 'unavailable', reason: 'source-adapter-unavailable' },
      exportCollections: this.targets.has(providerKey)
        ? { availability: 'available' }
        : { availability: 'unavailable', reason: 'target-adapter-unavailable' },
    }))
  }

  async listConnections(memberId: string): Promise<readonly ProviderConnectionV2[]> {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, provider_key, label, auth_method, state, action_required,
              revision::text, last_verified_at, created_at, updated_at
       FROM transfers.provider_connections
       WHERE owner_membership_id = $1::uuid
       ORDER BY provider_key, created_at, id`,
      [memberId],
    )
    return result.rows.map(connectionProjection)
  }

  private async lockCommand(client: PoolClient, commandId: string): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.transfers.v2:' || $1, 0))",
      [commandId],
    )
  }

  private async prior<Value>(client: PoolClient, input: Readonly<{
    commandId: string; memberId: string; kind: string; fingerprint: string
  }>): Promise<TransferCommandResult<Value> | 'pending' | undefined> {
    const row = (await client.query<ReceiptRow>(
      `SELECT owner_membership_id, command_kind, command_fingerprint, status, result
       FROM transfers.command_receipts WHERE command_id = $1::uuid`,
      [input.commandId],
    )).rows[0]
    if (row === undefined) return undefined
    if (
      row.owner_membership_id !== input.memberId || row.command_kind !== input.kind ||
      row.command_fingerprint !== input.fingerprint
    ) return rejection(input.commandId, 'command-id-reused')
    if (row.status === 'pending') return 'pending'
    if (row.status === 'accepted') {
      const reference = row.result.reference as Partial<ReceiptReference> | undefined
      if (
        reference?.kind === 'import-plan' && typeof reference.id === 'string' &&
        typeof reference.acceptedRevision === 'string'
      ) {
        const value = await this.getImportPlanWithClient(client, input.memberId, reference.id)
        if (value === undefined) throw new Error('accepted import plan receipt target is unavailable')
        return { status: 'replayed', commandId: input.commandId, value: value as Value }
      }
      if (
        reference?.kind === 'outbound-transfer' && typeof reference.id === 'string' &&
        typeof reference.acceptedRevision === 'string'
      ) {
        const value = await this.getOutboundTransferWithClient(client, input.memberId, reference.id)
        if (value === undefined) throw new Error('accepted outbound receipt target is unavailable')
        return { status: 'replayed', commandId: input.commandId, value: value as Value }
      }
      return {
        status: 'replayed', commandId: input.commandId,
        value: row.result.value as Value,
      }
    }
    return rejection(
      input.commandId,
      (row.result.rejection as { code: TransferCommandRejectionCodeV2 }).code,
    )
  }

  private async recordRejected<Value>(client: PoolClient, input: Readonly<{
    commandId: string; memberId: string; kind: string; fingerprint: string
    code: TransferCommandRejectionCodeV2; at: string
  }>): Promise<TransferCommandResult<Value>> {
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

  private async recordAccepted<Value>(client: PoolClient, input: Readonly<{
    commandId: string; memberId: string; kind: string; fingerprint: string
    value: Value; at: string; reference?: ReceiptReference
  }>): Promise<TransferCommandResult<Value>> {
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

  private async priorBeforeExternalIo<Value>(input: Readonly<{
    commandId: string; memberId: string; kind: string; fingerprint: string
  }>): Promise<TransferCommandResult<Value> | undefined> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, input.commandId)
      const prior = await this.prior<Value>(client, input)
      if (prior === 'pending') throw new Error('outbound command cannot remain pending')
      await client.query('COMMIT')
      return prior
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async applyConnectionCommand(
    memberId: string,
    command: ProviderConnectionCommandRequestV2,
  ): Promise<TransferCommandResult<ProviderConnectionV2>> {
    const kind = `provider-connection-${command.kind}`
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<ProviderConnectionV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      if (prior === 'pending') throw new Error('connection command cannot remain pending')
      let row: ConnectionRow | undefined
      if (command.kind === 'create') {
        if (
          !this.enabledConnectionAuthMethods.get(command.providerKey)?.has(command.authMethod) ||
          !authMethods[command.providerKey].includes(command.authMethod)
        ) {
          const result = await this.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'target-unavailable', at,
          })
          await client.query('COMMIT')
          return result
        }
        row = (await client.query<ConnectionRow>(
          `INSERT INTO transfers.provider_connections (
             id, owner_membership_id, provider_key, label, auth_method, state,
             action_required, revision, last_verified_at, created_at, updated_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,'action-required',
             'complete-authorization',1,NULL,$6::timestamptz,$6::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, provider_key, label, auth_method, state, action_required,
                     revision::text, last_verified_at, created_at, updated_at`,
          [command.connectionId, memberId, command.providerKey, command.label, command.authMethod, at],
        )).rows[0]
        if (row === undefined) {
          const result = await this.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint, code: 'not-found', at,
          })
          await client.query('COMMIT')
          return result
        }
      } else {
        const current = (await client.query<ConnectionRow>(
          `SELECT id, provider_key, label, auth_method, state, action_required,
                  revision::text, last_verified_at, created_at, updated_at
           FROM transfers.provider_connections
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
          [command.connectionId, memberId],
        )).rows[0]
        if (current === undefined) {
          const result = await this.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint, code: 'not-found', at,
          })
          await client.query('COMMIT')
          return result
        }
        if (
          readOpaqueRevision('provider-connection', command.expectedConnectionRevision,
            command.connectionId) !== current.revision
        ) {
          const result = await this.recordRejected<ProviderConnectionV2>(client, {
            commandId: command.commandId, memberId, kind, fingerprint,
            code: 'revision-conflict', at,
          })
          await client.query('COMMIT')
          return result
        }
        if (command.kind === 'rename') {
          row = (await client.query<ConnectionRow>(
            `UPDATE transfers.provider_connections
             SET label = $3, revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, provider_key, label, auth_method, state, action_required,
                       revision::text, last_verified_at, created_at, updated_at`,
            [command.connectionId, memberId, command.label, at],
          )).rows[0]
        } else {
          const state = command.kind === 'revoke' ? 'revoked' : 'action-required'
          const action = command.kind === 'revoke' ? null : 'reauthorize'
          row = (await client.query<ConnectionRow>(
            `UPDATE transfers.provider_connections
             SET state = $3, action_required = $4, revision = revision + 1,
                 updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
             WHERE id = $1::uuid AND owner_membership_id = $2::uuid
             RETURNING id, provider_key, label, auth_method, state, action_required,
                       revision::text, last_verified_at, created_at, updated_at`,
            [command.connectionId, memberId, state, action, at],
          )).rows[0]
        }
      }
      const value = connectionProjection(row!)
      const result = await this.recordAccepted(client, {
        commandId: command.commandId, memberId, kind, fingerprint, value, at,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async recordConnectionObservation(
    input: ProviderConnectionObservation,
  ): Promise<TransferCommandResult<ProviderConnectionV2>> {
    const kind = 'provider-connection-observation'
    const fingerprint = transferFingerprint(input)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, input.observationId)
      const prior = await this.prior<ProviderConnectionV2>(client, {
        commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const current = (await client.query<ConnectionRow>(
        `SELECT id, provider_key, label, auth_method, state, action_required,
                revision::text, last_verified_at, created_at, updated_at
         FROM transfers.provider_connections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [input.connectionId, input.ownerMemberId],
      )).rows[0]
      if (current === undefined || current.state === 'revoked') {
        const result = await this.recordRejected<ProviderConnectionV2>(client, {
          commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
          code: 'not-found', at: input.observedAt,
        })
        await client.query('COMMIT')
        return result
      }
      if (
        readOpaqueRevision('provider-connection', input.expectedConnectionRevision,
          input.connectionId) !== current.revision
      ) {
        const result = await this.recordRejected<ProviderConnectionV2>(client, {
          commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
          code: 'revision-conflict', at: input.observedAt,
        })
        await client.query('COMMIT')
        return result
      }
      await client.query(
        `INSERT INTO transfers.connection_observations (
           observation_id, connection_id, expected_connection_revision, observed_state,
           action_required, observed_at, observation_fingerprint
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz,$7)`,
        [input.observationId, input.connectionId, current.revision, input.observedState,
          input.observedState === 'action-required' ? 'reauthorize' : null,
          input.observedAt, fingerprint],
      )
      const row = (await client.query<ConnectionRow>(
        `UPDATE transfers.provider_connections
         SET state = $3, action_required = $4,
             last_verified_at = CASE WHEN $3 = 'ready' THEN $5::timestamptz ELSE last_verified_at END,
             revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid
         RETURNING id, provider_key, label, auth_method, state, action_required,
                   revision::text, last_verified_at, created_at, updated_at`,
        [input.connectionId, input.ownerMemberId, input.observedState,
          input.observedState === 'action-required' ? 'reauthorize' : null, input.observedAt],
      )).rows[0]!
      const value = connectionProjection(row)
      const result = await this.recordAccepted(client, {
        commandId: input.observationId, memberId: input.ownerMemberId, kind, fingerprint,
        value, at: input.observedAt,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async recordSourceSnapshot(input: SourceSnapshotCapture) {
    if (
      input.lists.length > 50 || input.lists.some((list) => list.items.length > 500) ||
      input.lists.reduce((count, list) => count + list.items.length, 0) > 10_000
    ) {
      throw new Error('source snapshot exceeds bounded projection limits')
    }
    const digest = transferFingerprint({
      connectionId: input.connectionId, providerKey: input.providerKey,
      sourceRevision: input.sourceRevision, observedAt: input.observedAt,
      capturedAt: input.capturedAt, lists: input.lists,
    })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.snapshot.v2:' || $1, 0))",
        [input.snapshotId],
      )
      const prior = (await client.query<{ content_digest: string }>(
        `SELECT content_digest FROM transfers.source_snapshots
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [input.snapshotId, input.ownerMemberId],
      )).rows[0]
      if (prior !== undefined) {
        if (prior.content_digest !== digest) throw new Error('source snapshot identity reused')
        await client.query('COMMIT')
        const snapshot = await this.getSnapshot(input.ownerMemberId, input.snapshotId)
        if (snapshot === undefined) throw new Error('source snapshot replay disappeared')
        return { status: 'replayed' as const, snapshot }
      }
      const connection = (await client.query<{ provider_key: ProviderKey; state: string }>(
        `SELECT provider_key, state FROM transfers.provider_connections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR SHARE`,
        [input.connectionId, input.ownerMemberId],
      )).rows[0]
      if (
        connection === undefined || connection.provider_key !== input.providerKey ||
        connection.state !== 'ready'
      ) throw new Error('source snapshot connection is not ready')
      await client.query(
        `INSERT INTO transfers.source_snapshots (
           id, owner_membership_id, connection_id, provider_key, source_revision,
           content_digest, observed_at, captured_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::timestamptz,$8::timestamptz)`,
        [input.snapshotId, input.ownerMemberId, input.connectionId, input.providerKey,
          input.sourceRevision, digest, input.observedAt, input.capturedAt],
      )
      for (const list of input.lists) {
        await client.query(
          `INSERT INTO transfers.source_snapshot_lists (
             snapshot_id, source_list_id, observed_name, source_position
           ) VALUES ($1::uuid,$2,$3,$4)`,
          [input.snapshotId, list.sourceListId, list.observedName, list.sourcePosition],
        )
        for (const item of list.items) {
          await client.query(
            `INSERT INTO transfers.source_snapshot_items (
               snapshot_id, source_list_id, source_item_id, provider_place_id,
               observed_name, observed_address, observed_category, observed_location,
               canonical_place_id, match_reason, source_position
             ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,
               CASE WHEN $8::float8 IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($9::float8,$8::float8),4326) END,
               $10::uuid,$11,$12)`,
            [input.snapshotId, list.sourceListId, item.sourceItemId, item.providerPlaceId,
              item.observedName, item.observedAddress, item.observedCategory,
              item.observedLocation?.latitude ?? null, item.observedLocation?.longitude ?? null,
              item.match.status === 'matched' ? item.match.placeId : null,
              item.match.status === 'unresolved' ? item.match.reason : null,
              item.sourcePosition],
          )
        }
      }
      await client.query('COMMIT')
      const snapshot = await this.getSnapshot(input.ownerMemberId, input.snapshotId)
      if (snapshot === undefined) throw new Error('source snapshot did not persist')
      return { status: 'applied' as const, snapshot }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async listSnapshots(input: Readonly<{
    memberId: string; connectionId?: string; cursor?: string; limit: number
  }>): Promise<SourceSnapshotListV2> {
    const after = readCursor(input.cursor)
    if (input.cursor !== undefined && after === undefined) throw new InvalidTransferCursorError()
    const result = await this.pool.query<{
      id: string; content_digest: string; connection_id: string; provider_key: ProviderKey
      source_revision: string; observed_at: Date; captured_at: Date
      list_count: number; item_count: number; unresolved_count: number
    }>(
      `SELECT snapshot.id, snapshot.content_digest, snapshot.connection_id, snapshot.provider_key,
              snapshot.source_revision, snapshot.observed_at, snapshot.captured_at,
              count(DISTINCT list.source_list_id)::int AS list_count,
              count(item.source_item_id)::int AS item_count,
              count(*) FILTER (
                WHERE item.source_item_id IS NOT NULL AND item.canonical_place_id IS NULL
              )::int AS unresolved_count
       FROM transfers.source_snapshots AS snapshot
       LEFT JOIN transfers.source_snapshot_lists AS list ON list.snapshot_id = snapshot.id
       LEFT JOIN transfers.source_snapshot_items AS item
         ON item.snapshot_id = list.snapshot_id AND item.source_list_id = list.source_list_id
       WHERE snapshot.owner_membership_id = $1::uuid
         AND ($2::uuid IS NULL OR snapshot.connection_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR snapshot.captured_at < $3::timestamptz
           OR (snapshot.captured_at = $3::timestamptz AND snapshot.id < $4::uuid))
       GROUP BY snapshot.id
       ORDER BY snapshot.captured_at DESC, snapshot.id DESC
       LIMIT $5`,
      [input.memberId, input.connectionId ?? null, after?.capturedAt ?? null,
        after?.snapshotId ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = result.rows.slice(0, input.limit)
    return {
      schemaVersion: 'source-snapshot-list.v2',
      items: rows.map((row) => ({
        snapshotId: row.id,
        snapshotVersion: snapshotVersion(row.id, row.content_digest),
        connectionId: row.connection_id,
        providerKey: row.provider_key,
        sourceRevision: row.source_revision,
        listCount: row.list_count,
        itemCount: row.item_count,
        unresolvedItemCount: row.unresolved_count,
        observedAt: row.observed_at.toISOString(),
        capturedAt: row.captured_at.toISOString(),
      })),
      ...(hasMore ? {
        nextCursor: cursor({
          capturedAt: rows.at(-1)!.captured_at.toISOString(), snapshotId: rows.at(-1)!.id,
        }),
      } : {}),
    }
  }

  async getSnapshot(memberId: string, snapshotId: string): Promise<SourceSnapshotDetailV2 | undefined> {
    const header = (await this.pool.query<{
      id: string; content_digest: string; connection_id: string; provider_key: ProviderKey
      source_revision: string; observed_at: Date; captured_at: Date
    }>(
      `SELECT id, content_digest, connection_id, provider_key, source_revision,
              observed_at, captured_at
       FROM transfers.source_snapshots
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [snapshotId, memberId],
    )).rows[0]
    if (header === undefined) return undefined
    const rows = await this.pool.query<{
      source_list_id: string; observed_list_name: string; list_position: number
      source_item_id: string | null; provider_place_id: string | null
      observed_name: string | null; observed_address: string | null
      observed_category: string | null; latitude: number | null; longitude: number | null
      canonical_place_id: string | null; match_reason: 'missing-identity' | 'ambiguous' | 'retired' | null
      item_position: number | null
    }>(
      `SELECT list.source_list_id, list.observed_name AS observed_list_name,
              list.source_position AS list_position,
              item.source_item_id, item.provider_place_id, item.observed_name,
              item.observed_address, item.observed_category,
              ST_Y(item.observed_location) AS latitude,
              ST_X(item.observed_location) AS longitude,
              item.canonical_place_id, item.match_reason, item.source_position AS item_position
       FROM transfers.source_snapshot_lists AS list
       LEFT JOIN transfers.source_snapshot_items AS item
         ON item.snapshot_id = list.snapshot_id AND item.source_list_id = list.source_list_id
       WHERE list.snapshot_id = $1::uuid
       ORDER BY list.source_position, list.source_list_id, item.source_position, item.source_item_id`,
      [snapshotId],
    )
    const lists = new Map<string, {
      sourceListId: string; observedName: string; sourcePosition: number
      items: SnapshotItem[]
    }>()
    for (const row of rows.rows) {
      let list = lists.get(row.source_list_id)
      if (list === undefined) {
        list = {
          sourceListId: row.source_list_id,
          observedName: row.observed_list_name,
          sourcePosition: row.list_position,
          items: [],
        }
        lists.set(row.source_list_id, list)
      }
      if (row.source_item_id !== null) list.items.push({
        sourceItemId: row.source_item_id,
        providerPlaceId: row.provider_place_id,
        observedName: row.observed_name!,
        observedAddress: row.observed_address,
        observedCategory: row.observed_category,
        observedLocation: row.latitude === null || row.longitude === null
          ? null : { latitude: row.latitude, longitude: row.longitude },
        match: row.canonical_place_id === null
          ? { status: 'unresolved', reason: row.match_reason! }
          : { status: 'matched', placeId: row.canonical_place_id },
        sourcePosition: row.item_position!,
      })
    }
    const projectedLists = [...lists.values()].map((list) => ({
      ...list,
      itemCount: list.items.length,
      unresolvedItemCount: list.items.filter((item) => (
        (item.match as { status: string }).status === 'unresolved'
      )).length,
    }))
    return {
      schemaVersion: 'source-snapshot-detail.v2',
      snapshotId: header.id,
      snapshotVersion: snapshotVersion(header.id, header.content_digest),
      connectionId: header.connection_id,
      providerKey: header.provider_key,
      sourceRevision: header.source_revision,
      listCount: projectedLists.length,
      itemCount: projectedLists.reduce((sum, list) => sum + list.itemCount, 0),
      unresolvedItemCount: projectedLists.reduce((sum, list) => sum + list.unresolvedItemCount, 0),
      observedAt: header.observed_at.toISOString(),
      capturedAt: header.captured_at.toISOString(),
      lists: projectedLists,
    }
  }

  async applyImportPlanCommand(
    memberId: string,
    command: ImportPlanCommandRequestV2,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    if (command.kind === 'create') return this.createImportPlan(memberId, command)
    if (command.kind === 'decide-item') return this.decideImportItem(memberId, command)
    return this.approveImportPlan(memberId, command)
  }

  private async createImportPlan(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'create' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-create'
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const snapshot = await this.getSnapshot(memberId, command.snapshotId)
    const targetIds = command.mappings.map((mapping) => mapping.target.collectionId)
    if (snapshot === undefined) return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'not-found', at)
    if (snapshot.snapshotVersion !== command.expectedSnapshotVersion) {
      return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'snapshot-changed', at)
    }
    if (new Set(command.mappings.map((mapping) => mapping.sourceListId)).size !== command.mappings.length) {
      return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
    }
    for (const targetId of new Set(targetIds)) {
      const sameTarget = command.mappings.filter((mapping) => mapping.target.collectionId === targetId)
      if (sameTarget.length > 1 && sameTarget.some((mapping) => mapping.target.kind === 'new')) {
        return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
    }
    const prepared: Array<{
      sourceList: SourceSnapshotDetailV2['lists'][number]
      target: typeof command.mappings[number]['target']
      existingPlaceIds: ReadonlySet<string>
      expectedBindingVersion: string | null
    }> = []
    for (const mapping of command.mappings) {
      const sourceList = snapshot.lists.find((list) => list.sourceListId === mapping.sourceListId)
      if (sourceList === undefined) {
        return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      let existingPlaceIds: ReadonlySet<string> = new Set()
      const binding = await this.collections.readImportBinding({
        memberId,
        providerKey: snapshot.providerKey,
        connectionId: snapshot.connectionId,
        sourceListId: mapping.sourceListId,
      })
      if (binding !== undefined && binding.collectionId !== mapping.target.collectionId) {
        return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      const observed = await this.collections.read({ memberId, collectionId: mapping.target.collectionId })
      if (mapping.target.kind === 'existing') {
        if (observed === undefined) {
          return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'not-found', at)
        }
        if (observed.collectionVersion !== mapping.target.expectedCollectionRevision) {
          return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'collection-changed', at)
        }
        existingPlaceIds = new Set(observed.items.map((item) => item.placeId))
      } else if (observed !== undefined) {
        return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
      }
      prepared.push({
        sourceList, target: mapping.target, existingPlaceIds,
        expectedBindingVersion: binding?.bindingVersion ?? null,
      })
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<ImportPlanV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      await client.query(
        `INSERT INTO transfers.import_plans (
           id, owner_membership_id, snapshot_id, snapshot_digest, state, revision,
           blocked_reason, approval_command_id, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'draft',1,NULL,NULL,$5::timestamptz,$5::timestamptz)`,
        [command.planId, memberId, command.snapshotId,
          readOpaqueRevision('source-snapshot', snapshot.snapshotVersion, snapshot.snapshotId), at],
      )
      for (const entry of prepared) {
        await client.query(
          `INSERT INTO transfers.import_plan_source_lists (plan_id, snapshot_id, source_list_id)
           VALUES ($1::uuid,$2::uuid,$3)`,
          [command.planId, command.snapshotId, entry.sourceList.sourceListId],
        )
        const operationId = deterministicOperationId(
          'import-plan', command.planId, entry.sourceList.sourceListId,
        )
        await client.query(
          `INSERT INTO transfers.import_plan_mappings (
             plan_id, source_list_id, target_kind, target_collection_id, target_name,
             expected_collection_version, expected_binding_version,
             materialization_state, materialization_operation_id,
             collection_version, rejection_code
           ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,'pending',$8::uuid,NULL,NULL)`,
          [command.planId, entry.sourceList.sourceListId, entry.target.kind,
            entry.target.collectionId, entry.target.kind === 'new' ? entry.target.name : null,
            entry.target.kind === 'existing' ? entry.target.expectedCollectionRevision : null,
            entry.expectedBindingVersion, operationId],
        )
        for (const item of entry.sourceList.items) {
          const resolved = item.match.status === 'matched' && item.providerPlaceId !== null
            ? item.match.placeId : null
          const status = resolved === null
            ? 'unresolved'
            : entry.existingPlaceIds.has(resolved) ? 'already-present' : 'add'
          await client.query(
            `INSERT INTO transfers.import_plan_items (
               plan_id, source_list_id, source_item_id, resolved_place_id,
               preview_status, decision_kind
             ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6)`,
            [command.planId, entry.sourceList.sourceListId, item.sourceItemId, resolved,
              status, resolved === null ? 'none' : 'snapshot-match'],
          )
        }
      }
      const value = await this.getImportPlanWithClient(client, memberId, command.planId)
      if (value === undefined) throw new Error('import plan projection unavailable')
      const result = await this.recordAccepted(client, {
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
    } finally {
      client.release()
    }
  }

  private async decideImportItem(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'decide-item' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-decide-item'
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<ImportPlanV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const plan = (await client.query<{ revision: string; state: string }>(
        `SELECT revision::text, state FROM transfers.import_plans
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [command.planId, memberId],
      )).rows[0]
      if (plan === undefined) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-found', at)
      if (
        plan.state !== 'draft' ||
        readOpaqueRevision('import-plan', command.expectedPlanRevision, command.planId) !== plan.revision
      ) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'revision-conflict', at)
      const item = (await client.query<{
        provider_place_id: string | null; target_kind: 'new' | 'existing'
        target_collection_id: string; expected_collection_version: string | null
      }>(
        `SELECT snapshot_item.provider_place_id, mapping.target_kind,
                mapping.target_collection_id, mapping.expected_collection_version
         FROM transfers.import_plan_items AS planned
         JOIN transfers.import_plans AS plan ON plan.id = planned.plan_id
         JOIN transfers.import_plan_mappings AS mapping
           ON mapping.plan_id = planned.plan_id AND mapping.source_list_id = planned.source_list_id
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = plan.snapshot_id
          AND snapshot_item.source_list_id = planned.source_list_id
          AND snapshot_item.source_item_id = planned.source_item_id
         WHERE planned.plan_id = $1::uuid AND planned.source_list_id = $2
           AND planned.source_item_id = $3`,
        [command.planId, command.sourceListId, command.sourceItemId],
      )).rows[0]
      if (item === undefined) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-found', at)
      let resolvedPlaceId: string | null = null
      let status: 'add' | 'already-present' | 'skipped'
      if (command.decision.kind === 'skip') {
        status = 'skipped'
      } else {
        if (item.provider_place_id === null) {
          return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
        }
        const place = await client.query('SELECT 1 FROM places.canonical_places WHERE id = $1::uuid', [command.decision.placeId])
        if (place.rows[0] === undefined) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-found', at)
        resolvedPlaceId = command.decision.placeId
        status = 'add'
        if (item.target_kind === 'existing') {
          const observed = await this.collections.read({ memberId, collectionId: item.target_collection_id })
          if (observed === undefined || observed.collectionVersion !== item.expected_collection_version) {
            return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'collection-changed', at)
          }
          if (observed.items.some((candidate) => candidate.placeId === resolvedPlaceId)) status = 'already-present'
        }
      }
      await client.query(
        `UPDATE transfers.import_plan_items
         SET resolved_place_id = $4::uuid, preview_status = $5, decision_kind = $6
         WHERE plan_id = $1::uuid AND source_list_id = $2 AND source_item_id = $3`,
        [command.planId, command.sourceListId, command.sourceItemId, resolvedPlaceId,
          status, command.decision.kind],
      )
      await client.query(
        `UPDATE transfers.import_plans
         SET revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $3::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [command.planId, memberId, at],
      )
      const value = await this.getImportPlanWithClient(client, memberId, command.planId)
      if (value === undefined) throw new Error('import plan projection unavailable')
      const result = await this.recordAccepted(client, {
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
    } finally {
      client.release()
    }
  }

  private async approveImportPlan(
    memberId: string,
    command: Extract<ImportPlanCommandRequestV2, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<ImportPlanV2>> {
    const kind = 'import-plan-approve'
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const client = await this.pool.connect()
    let resume = false
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<ImportPlanV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      resume = prior === 'pending'
      const plan = (await client.query<{ revision: string; state: string; unresolved: number }>(
        `SELECT plan.revision::text, plan.state,
                (SELECT count(*)::int FROM transfers.import_plan_items AS item
                 WHERE item.plan_id = plan.id AND item.preview_status = 'unresolved') AS unresolved
         FROM transfers.import_plans AS plan
         WHERE plan.id = $1::uuid AND plan.owner_membership_id = $2::uuid
         FOR UPDATE`,
        [command.planId, memberId],
      )).rows[0]
      if (plan === undefined) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-found', at)
      if (!resume && (
        plan.state !== 'draft' ||
        readOpaqueRevision('import-plan', command.expectedPlanRevision, command.planId) !== plan.revision
      )) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'revision-conflict', at)
      if (!resume && plan.unresolved > 0) {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-approvable', at)
      }
      if (!resume) {
        await client.query(
          `UPDATE transfers.import_plans
           SET state = 'applying', approval_command_id = $3::uuid, revision = revision + 1,
               updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
           WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
          [command.planId, memberId, command.commandId, at],
        )
        await client.query(
          `INSERT INTO transfers.command_receipts (
             command_id, owner_membership_id, command_kind, command_fingerprint,
             status, result, created_at, completed_at
           ) VALUES ($1::uuid,$2::uuid,$3,$4,'pending','{}'::jsonb,$5::timestamptz,NULL)`,
          [command.commandId, memberId, kind, fingerprint, at],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    const mappings = await this.pool.query<{
      source_list_id: string; observed_name: string; source_position: number
      provider_key: ProviderKey; connection_id: string
      target_kind: 'new' | 'existing'; target_collection_id: string
      target_name: string | null; expected_collection_version: string | null
      expected_binding_version: string | null; materialization_operation_id: string
      materialization_state: 'pending' | 'applied' | 'rejected'
      collection_version: string | null
    }>(
      `SELECT mapping.source_list_id, list.observed_name, list.source_position,
              snapshot.provider_key, snapshot.connection_id, mapping.target_kind,
              mapping.target_collection_id, mapping.target_name,
              mapping.expected_collection_version, mapping.expected_binding_version,
              mapping.materialization_operation_id, mapping.materialization_state,
              mapping.collection_version
       FROM transfers.import_plan_mappings AS mapping
       JOIN transfers.import_plans AS plan ON plan.id = mapping.plan_id
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       JOIN transfers.source_snapshot_lists AS list
         ON list.snapshot_id = plan.snapshot_id AND list.source_list_id = mapping.source_list_id
       WHERE mapping.plan_id = $1::uuid ORDER BY list.source_position, list.source_list_id`,
      [command.planId],
    )
    let materializationRejected = false
    const latestCollectionVersions = new Map<string, string>()
    for (const mapping of mappings.rows) {
      if (mapping.materialization_state === 'applied') {
        if (mapping.collection_version === null) {
          throw new Error('applied import mapping is missing its Collection version')
        }
        latestCollectionVersions.set(mapping.target_collection_id, mapping.collection_version)
        continue
      }
      const items = await this.pool.query<{
        source_item_id: string; provider_place_id: string; resolved_place_id: string
        source_position: number
      }>(
        `SELECT planned.source_item_id, snapshot_item.provider_place_id,
                planned.resolved_place_id, snapshot_item.source_position
         FROM transfers.import_plan_items AS planned
         JOIN transfers.import_plans AS plan ON plan.id = planned.plan_id
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = plan.snapshot_id
          AND snapshot_item.source_list_id = planned.source_list_id
          AND snapshot_item.source_item_id = planned.source_item_id
         WHERE planned.plan_id = $1::uuid AND planned.source_list_id = $2
           AND planned.preview_status IN ('add', 'already-present')
         ORDER BY snapshot_item.source_position, planned.source_item_id`,
        [command.planId, mapping.source_list_id],
      )
      const result = await this.materializer.materialize({
        context: {
          operationId: mapping.materialization_operation_id,
          memberId,
          occurredAt: at,
        },
        source: {
          providerKey: mapping.provider_key,
          connectionId: mapping.connection_id,
          sourceListId: mapping.source_list_id,
          sourcePosition: mapping.source_position,
          observedName: mapping.observed_name,
        },
        target: mapping.target_kind === 'new'
          ? { kind: 'new', collectionId: mapping.target_collection_id, name: mapping.target_name! }
          : {
              kind: 'existing', collectionId: mapping.target_collection_id,
              expectedVersion: latestCollectionVersions.get(mapping.target_collection_id) ??
                mapping.expected_collection_version!,
            },
        ...(mapping.expected_binding_version === null
          ? {} : { expectedBindingVersion: mapping.expected_binding_version }),
        items: items.rows.map((item) => ({
          sourceItemId: item.source_item_id,
          providerPlaceId: item.provider_place_id,
          placeId: item.resolved_place_id,
          sourcePosition: item.source_position,
        })),
      })
      if (result.status === 'rejected') {
        materializationRejected = true
        await this.pool.query(
          `UPDATE transfers.import_plan_mappings
           SET materialization_state = 'rejected', rejection_code = $3
           WHERE plan_id = $1::uuid AND source_list_id = $2`,
          [command.planId, mapping.source_list_id, result.rejection.code],
        )
        break
      }
      await this.pool.query(
        `UPDATE transfers.import_plan_mappings
         SET materialization_state = 'applied', collection_version = $3
         WHERE plan_id = $1::uuid AND source_list_id = $2`,
        [command.planId, mapping.source_list_id, result.value.version],
      )
      latestCollectionVersions.set(mapping.target_collection_id, result.value.version)
    }
    const finishedAt = this.now().toISOString()
    const finalClient = await this.pool.connect()
    try {
      await finalClient.query('BEGIN')
      await finalClient.query(
        `UPDATE transfers.import_plans
         SET state = $3, blocked_reason = $4, revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $5::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid AND state = 'applying'`,
        [command.planId, memberId, materializationRejected ? 'blocked' : 'completed',
          materializationRejected ? 'materialization-rejected' : null, finishedAt],
      )
      const value = await this.getImportPlanWithClient(finalClient, memberId, command.planId)
      if (value === undefined) throw new Error('import plan completion projection unavailable')
      await finalClient.query(
        `UPDATE transfers.command_receipts
         SET status = 'accepted', result = $2::jsonb, completed_at = $3::timestamptz
         WHERE command_id = $1::uuid AND status = 'pending'`,
        [command.commandId, JSON.stringify({
          reference: {
            kind: 'import-plan', id: value.planId, acceptedRevision: value.planRevision,
          },
        }), finishedAt],
      )
      await finalClient.query('COMMIT')
      return { status: 'applied', commandId: command.commandId, value }
    } catch (error) {
      await finalClient.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      finalClient.release()
    }
  }

  private async rejectStandalone<Value>(
    commandId: string, memberId: string, kind: string, fingerprint: string,
    code: TransferCommandRejectionCodeV2, at: string,
  ): Promise<TransferCommandResult<Value>> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, commandId)
      const prior = await this.prior<Value>(client, { commandId, memberId, kind, fingerprint })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const result = await this.recordRejected<Value>(client, {
        commandId, memberId, kind, fingerprint, code, at,
      })
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async rejectInTransaction<Value>(
    client: PoolClient, commandId: string, memberId: string, kind: string,
    fingerprint: string, code: TransferCommandRejectionCodeV2, at: string,
  ): Promise<TransferCommandResult<Value>> {
    const result = await this.recordRejected<Value>(client, {
      commandId, memberId, kind, fingerprint, code, at,
    })
    await client.query('COMMIT')
    return result
  }

  async getImportPlan(memberId: string, planId: string): Promise<ImportPlanV2 | undefined> {
    const client = await this.pool.connect()
    try {
      return await this.getImportPlanWithClient(client, memberId, planId)
    } finally {
      client.release()
    }
  }

  private async getImportPlanWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    planId: string,
  ): Promise<ImportPlanV2 | undefined> {
    const plan = (await client.query<{
      id: string; revision: string; state: ImportPlanV2['state']; blocked_reason: string | null
      snapshot_id: string; snapshot_digest: string; provider_key: ProviderKey; connection_id: string
      created_at: Date; updated_at: Date
    }>(
      `SELECT plan.id, plan.revision::text, plan.state, plan.blocked_reason,
              plan.snapshot_id, plan.snapshot_digest, snapshot.provider_key,
              snapshot.connection_id, plan.created_at, plan.updated_at
       FROM transfers.import_plans AS plan
       JOIN transfers.source_snapshots AS snapshot ON snapshot.id = plan.snapshot_id
       WHERE plan.id = $1::uuid AND plan.owner_membership_id = $2::uuid`,
      [planId, memberId],
    )).rows[0]
    if (plan === undefined) return undefined
    const mappings = await client.query<{
      source_list_id: string; observed_name: string; source_position: number
      target_kind: 'new' | 'existing'; target_collection_id: string
      target_name: string | null; expected_collection_version: string | null
      materialization_state: 'pending' | 'applied' | 'rejected'
      collection_version: string | null; rejection_code: string | null
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
    const projectedMappings = []
    for (const mapping of mappings.rows) {
      const items = await client.query<{
        source_item_id: string; provider_place_id: string | null
        observed_name: string; observed_address: string | null
        resolved_place_id: string | null
        preview_status: 'add' | 'already-present' | 'unresolved' | 'skipped'
        decision_kind: 'snapshot-match' | 'link' | 'skip' | 'none'
      }>(
        `SELECT planned.source_item_id, snapshot_item.provider_place_id,
                snapshot_item.observed_name, snapshot_item.observed_address,
                planned.resolved_place_id, planned.preview_status, planned.decision_kind
         FROM transfers.import_plan_items AS planned
         JOIN transfers.source_snapshot_items AS snapshot_item
           ON snapshot_item.snapshot_id = $3::uuid
          AND snapshot_item.source_list_id = planned.source_list_id
          AND snapshot_item.source_item_id = planned.source_item_id
         WHERE planned.plan_id = $1::uuid AND planned.source_list_id = $2
         ORDER BY snapshot_item.source_position, planned.source_item_id`,
        [planId, mapping.source_list_id, plan.snapshot_id],
      )
      const counts = (status: string) => items.rows.filter((item) => item.preview_status === status).length
      projectedMappings.push({
        sourceListId: mapping.source_list_id,
        observedName: mapping.observed_name,
        sourcePosition: mapping.source_position,
        target: mapping.target_kind === 'new'
          ? { kind: 'new' as const, collectionId: mapping.target_collection_id, name: mapping.target_name! }
          : {
              kind: 'existing' as const, collectionId: mapping.target_collection_id,
              expectedCollectionRevision: mapping.expected_collection_version!,
            },
        itemCount: items.rows.length,
        unresolvedItemCount: counts('unresolved'),
        preview: {
          addCount: counts('add'), alreadyPresentCount: counts('already-present'),
          unresolvedCount: counts('unresolved'), skippedCount: counts('skipped'),
          items: items.rows.map((item) => ({
            sourceItemId: item.source_item_id,
            providerPlaceId: item.provider_place_id,
            observedName: item.observed_name,
            observedAddress: item.observed_address,
            placeId: item.resolved_place_id,
            status: item.preview_status,
            decision: item.decision_kind,
          })),
        },
        materialization: {
          state: mapping.materialization_state,
          collectionRevision: mapping.collection_version,
          rejectionCode: mapping.rejection_code,
        },
      })
    }
    const unresolved = projectedMappings.reduce((sum, mapping) => sum + mapping.unresolvedItemCount, 0)
    const decided = plan.state !== 'draft'
    return {
      schemaVersion: 'import-plan.v2',
      planId: plan.id,
      planRevision: planVersion(plan.id, plan.revision),
      snapshotId: plan.snapshot_id,
      snapshotVersion: snapshotVersion(plan.snapshot_id, plan.snapshot_digest),
      providerKey: plan.provider_key,
      connectionId: plan.connection_id,
      state: plan.state,
      approval: {
        eligible: !decided && unresolved === 0,
        reason: decided
          ? plan.blocked_reason === 'materialization-rejected'
            ? 'materialization-rejected' : 'already-decided'
          : unresolved > 0 ? 'unresolved-places' : null,
      },
      mappings: projectedMappings,
      createdAt: plan.created_at.toISOString(),
      updatedAt: plan.updated_at.toISOString(),
    }
  }

  async listTargetLists(memberId: string, connectionId: string) {
    const connection = (await this.pool.query<{ provider_key: ProviderKey; state: string }>(
      `SELECT provider_key, state FROM transfers.provider_connections
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [connectionId, memberId],
    )).rows[0]
    if (connection === undefined) return undefined
    if (connection.state !== 'ready') return {
      connectionId, availability: 'unavailable' as const,
      reason: 'connection-not-ready' as const, targetObservationRevision: null, items: [],
    }
    const target = this.targets.get(connection.provider_key)
    if (target === undefined) return {
      connectionId, availability: 'unavailable' as const,
      reason: 'target-adapter-unavailable' as const, targetObservationRevision: null, items: [],
    }
    const observation = await target.observe({ memberId, connectionId })
    return {
      connectionId, availability: 'available' as const, reason: null,
      targetObservationRevision: observation.revision, items: observation.lists,
    }
  }

  async applyOutboundTransferCommand(
    memberId: string,
    command: OutboundTransferCommandRequestV2,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    return command.kind === 'preview'
      ? this.previewOutboundTransfer(memberId, command)
      : this.approveOutboundTransfer(memberId, command)
  }

  private async previewOutboundTransfer(
    memberId: string,
    command: Extract<OutboundTransferCommandRequestV2, { kind: 'preview' }>,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    const kind = 'outbound-transfer-preview'
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const prior = await this.priorBeforeExternalIo<OutboundTransferV2>({
      commandId: command.commandId, memberId, kind, fingerprint,
    })
    if (prior !== undefined) return prior
    const source = await this.collections.read({ memberId, collectionId: command.collectionId })
    if (source === undefined) return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'not-found', at)
    if (source.collectionVersion !== command.expectedCollectionRevision) {
      return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'collection-changed', at)
    }
    const selected = command.selection.kind === 'all'
      ? [...source.items]
      : command.selection.placeIds.map((placeId) => source.items.find((item) => item.placeId === placeId))
    if (selected.some((item) => item === undefined)) {
      return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'invalid-selection', at)
    }
    const items = selected as Array<{ placeId: string; sourcePosition: number }>
    const connection = (await this.pool.query<{ provider_key: ProviderKey; state: string }>(
      `SELECT provider_key, state FROM transfers.provider_connections
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [command.connectionId, memberId],
    )).rows[0]
    if (connection === undefined) return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'not-found', at)
    const target = this.targets.get(connection.provider_key)
    let state: 'draft' | 'blocked' = 'blocked'
    let blockedReason: 'connection-not-ready' | 'target-adapter-unavailable' | null = null
    let observationRevision: string | null = null
    let statuses: Array<{ placeId: string; status: 'add' | 'already-present' | 'unresolved' | 'unsupported' | 'unknown' }>
    if (connection.state !== 'ready') {
      blockedReason = 'connection-not-ready'
      statuses = items.map((item) => ({ placeId: item.placeId, status: 'unknown' }))
    } else if (target === undefined) {
      blockedReason = 'target-adapter-unavailable'
      statuses = items.map((item) => ({ placeId: item.placeId, status: 'unknown' }))
    } else {
      const preflight = await target.preflight({
        memberId, connectionId: command.connectionId, target: command.target, items,
      })
      state = 'draft'
      observationRevision = preflight.observationRevision
      statuses = [...preflight.items]
      const requestedIds = new Set(items.map((item) => item.placeId))
      const returnedIds = new Set(statuses.map((item) => item.placeId))
      if (
        statuses.length !== items.length || returnedIds.size !== requestedIds.size ||
        [...requestedIds].some((placeId) => !returnedIds.has(placeId))
      ) return this.rejectStandalone(command.commandId, memberId, kind, fingerprint, 'target-unavailable', at)
    }
    const planDigest = transferFingerprint({
      memberId, connectionId: command.connectionId, providerKey: connection.provider_key,
      collectionId: command.collectionId, collectionVersion: source.collectionVersion,
      selection: command.selection, target: command.target, observationRevision, statuses,
    })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<OutboundTransferV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
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
        const preview = statuses.find((candidate) => candidate.placeId === item.placeId)!
        await client.query(
          `INSERT INTO transfers.outbound_transfer_items (
             transfer_id, canonical_place_id, source_position, preview_status
           ) VALUES ($1::uuid,$2::uuid,$3,$4)`,
          [command.transferId, item.placeId, item.sourcePosition, preview.status],
        )
      }
      const value = await this.getOutboundTransferWithClient(client, memberId, command.transferId)
      if (value === undefined) throw new Error('outbound preview projection unavailable')
      const result = await this.recordAccepted(client, {
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
    } finally {
      client.release()
    }
  }

  private async approveOutboundTransfer(
    memberId: string,
    command: Extract<OutboundTransferCommandRequestV2, { kind: 'approve' }>,
  ): Promise<TransferCommandResult<OutboundTransferV2>> {
    const kind = 'outbound-transfer-approve'
    const fingerprint = transferFingerprint({ memberId, command })
    const at = this.now().toISOString()
    const prior = await this.priorBeforeExternalIo<OutboundTransferV2>({
      commandId: command.commandId, memberId, kind, fingerprint,
    })
    if (prior !== undefined) return prior
    const preview = await this.getOutboundTransfer(memberId, command.transferId)
    const targetBeforeLock = preview === undefined ? undefined : this.targets.get(preview.providerKey)
    const targetObservation = preview === undefined || preview.targetObservationRevision === null ||
      targetBeforeLock === undefined
      ? undefined
      : await targetBeforeLock.observe({ memberId, connectionId: preview.connectionId })
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.lockCommand(client, command.commandId)
      const prior = await this.prior<OutboundTransferV2>(client, {
        commandId: command.commandId, memberId, kind, fingerprint,
      })
      if (prior !== undefined && prior !== 'pending') {
        await client.query('COMMIT')
        return prior
      }
      const transfer = (await client.query<{
        revision: string; state: string; blocked_reason: string | null
        collection_id: string; collection_version: string; connection_id: string
        provider_key: ProviderKey; target_observation_version: string | null
      }>(
        `SELECT revision::text, state, blocked_reason, collection_id, collection_version,
                connection_id, provider_key, target_observation_version
         FROM transfers.outbound_transfers
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR UPDATE`,
        [command.transferId, memberId],
      )).rows[0]
      if (transfer === undefined) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-found', at)
      if (transfer.state === 'blocked') {
        const code = transfer.blocked_reason === 'connection-not-ready'
          ? 'connection-not-ready' : 'target-unavailable'
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, code, at)
      }
      if (
        transfer.state !== 'draft' ||
        readOpaqueRevision('outbound-transfer', command.expectedTransferRevision,
          command.transferId) !== transfer.revision
      ) return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'revision-conflict', at)
      const ineligibleItems = Number((await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM transfers.outbound_transfer_items
         WHERE transfer_id = $1::uuid AND preview_status IN ('unresolved', 'unsupported', 'unknown')`,
        [command.transferId],
      )).rows[0]!.count)
      if (ineligibleItems > 0) {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'not-approvable', at)
      }
      const source = await this.collections.read({ memberId, collectionId: transfer.collection_id })
      if (source === undefined || source.collectionVersion !== transfer.collection_version) {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'collection-changed', at)
      }
      const connection = (await client.query<{ state: string }>(
        `SELECT state FROM transfers.provider_connections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR SHARE`,
        [transfer.connection_id, memberId],
      )).rows[0]
      if (connection?.state !== 'ready') {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'connection-not-ready', at)
      }
      if (targetBeforeLock === undefined || targetObservation === undefined) {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'target-unavailable', at)
      }
      if (targetObservation.revision !== transfer.target_observation_version) {
        return this.rejectInTransaction(client, command.commandId, memberId, kind, fingerprint, 'target-observation-changed', at)
      }
      await client.query(
        `UPDATE transfers.outbound_transfers
         SET state = 'approved', approval_command_id = $3::uuid, revision = revision + 1,
             updated_at = greatest(updated_at + interval '1 millisecond', $4::timestamptz)
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
        [command.transferId, memberId, command.commandId, at],
      )
      const value = await this.getOutboundTransferWithClient(client, memberId, command.transferId)
      if (value === undefined) throw new Error('approved outbound projection unavailable')
      const result = await this.recordAccepted(client, {
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
    } finally {
      client.release()
    }
  }

  async getOutboundTransfer(memberId: string, transferId: string) {
    const client = await this.pool.connect()
    try {
      return await this.getOutboundTransferWithClient(client, memberId, transferId)
    } finally {
      client.release()
    }
  }

  private async getOutboundTransferWithClient(
    client: Pick<PoolClient, 'query'>,
    memberId: string,
    transferId: string,
  ): Promise<OutboundTransferV2 | undefined> {
    const transfer = (await client.query<{
      id: string; revision: string; provider_key: ProviderKey; connection_id: string
      collection_id: string; collection_version: string; selection_kind: 'all' | 'places'
      plan_digest: string; target_kind: 'new-list' | 'existing-list'
      target_name: string | null; target_list_id: string | null
      target_observation_version: string | null; state: OutboundTransferV2['state']
      blocked_reason: 'target-adapter-unavailable' | 'connection-not-ready' | 'apply-failed' | null
      item_count: number; approval_command_id: string | null
      created_at: Date; updated_at: Date
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
      canonical_place_id: string; preview_status: OutboundTransferV2['preview']['items'][number]['status']
    }>(
      `SELECT canonical_place_id, preview_status
       FROM transfers.outbound_transfer_items
       WHERE transfer_id = $1::uuid ORDER BY source_position, canonical_place_id`,
      [transferId],
    )
    const unavailable = transfer.target_observation_version === null
    const count = (status: string) => items.rows.filter((item) => item.preview_status === status).length
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
          placeId: item.canonical_place_id, status: item.preview_status,
        })),
      },
      approval: {
        eligible: transfer.state === 'draft' &&
          !items.rows.some((item) => ['unresolved', 'unsupported', 'unknown'].includes(item.preview_status)),
        reason: transfer.state === 'blocked'
          ? transfer.blocked_reason
          : transfer.state === 'draft'
            ? items.rows.some((item) => ['unresolved', 'unsupported', 'unknown'].includes(item.preview_status))
              ? 'preview-has-unresolved-items' : null
            : 'already-decided',
      },
      approvalReceipt: transfer.approval_command_id === null ? null : {
        commandId: transfer.approval_command_id,
        planDigest: transfer.plan_digest,
        approvedAt: transfer.updated_at.toISOString(),
      },
      createdAt: transfer.created_at.toISOString(),
      updatedAt: transfer.updated_at.toISOString(),
    }
  }
}
