import { snapshotVersion } from '../../../application/identity.js'
import { InvalidTransferCursorError } from '../../../domain/model.js'
import type {
  SnapshotItem,
  SourceSnapshotCapture,
  SourceSnapshotDetailV2,
  SourceSnapshotListV2,
} from '../../../domain/model.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

function encodeCursor(input: Readonly<{ capturedAt: string; snapshotId: string }>): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined) {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as
      Record<string, unknown>
    if (typeof parsed.capturedAt !== 'string' || typeof parsed.snapshotId !== 'string') {
      return undefined
    }
    return { capturedAt: parsed.capturedAt, snapshotId: parsed.snapshotId }
  } catch {
    return undefined
  }
}

export class ProviderSourceSnapshots {
  constructor(private readonly context: ProviderTransferContext) {}

  async record(input: SourceSnapshotCapture) {
    if (input.lists.length > 50 || input.lists.some((list) => list.items.length > 500) ||
      input.lists.reduce((count, list) => count + list.items.length, 0) > 10_000) {
      throw new Error('source snapshot exceeds bounded projection limits')
    }
    const digest = this.context.fingerprint({
      connectionId: input.connectionId,
      providerKey: input.providerKey,
      sourceRevision: input.sourceRevision,
      observedAt: input.observedAt,
      capturedAt: input.capturedAt,
      lists: input.lists,
    })
    const client = await this.context.pool.connect()
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
        const snapshot = await this.get(input.ownerMemberId, input.snapshotId)
        if (snapshot === undefined) throw new Error('source snapshot replay disappeared')
        return { status: 'replayed' as const, snapshot }
      }
      const connection = (await client.query<{ provider_key: ProviderKey; state: string }>(
        `SELECT provider_key, state FROM transfers.provider_connections
         WHERE id = $1::uuid AND owner_membership_id = $2::uuid FOR SHARE`,
        [input.connectionId, input.ownerMemberId],
      )).rows[0]
      if (connection === undefined || connection.provider_key !== input.providerKey ||
        connection.state !== 'ready') {
        throw new Error('source snapshot connection is not ready')
      }
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
      const snapshot = await this.get(input.ownerMemberId, input.snapshotId)
      if (snapshot === undefined) throw new Error('source snapshot did not persist')
      return { status: 'applied' as const, snapshot }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async list(input: Readonly<{
    memberId: string
    connectionId?: string
    cursor?: string
    limit: number
  }>): Promise<SourceSnapshotListV2> {
    const after = decodeCursor(input.cursor)
    if (input.cursor !== undefined && after === undefined) throw new InvalidTransferCursorError()
    const result = await this.context.pool.query<{
      id: string
      content_digest: string
      connection_id: string
      provider_key: ProviderKey
      source_revision: string
      observed_at: Date
      captured_at: Date
      list_count: number
      item_count: number
      unresolved_count: number
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
        nextCursor: encodeCursor({
          capturedAt: rows.at(-1)!.captured_at.toISOString(),
          snapshotId: rows.at(-1)!.id,
        }),
      } : {}),
    }
  }

  async get(memberId: string, snapshotId: string): Promise<SourceSnapshotDetailV2 | undefined> {
    const header = (await this.context.pool.query<{
      id: string
      content_digest: string
      connection_id: string
      provider_key: ProviderKey
      source_revision: string
      observed_at: Date
      captured_at: Date
    }>(
      `SELECT id, content_digest, connection_id, provider_key, source_revision,
              observed_at, captured_at
       FROM transfers.source_snapshots
       WHERE id = $1::uuid AND owner_membership_id = $2::uuid`,
      [snapshotId, memberId],
    )).rows[0]
    if (header === undefined) return undefined
    const rows = await this.context.pool.query<{
      source_list_id: string
      observed_list_name: string
      list_position: number
      source_item_id: string | null
      provider_place_id: string | null
      observed_name: string | null
      observed_address: string | null
      observed_category: string | null
      latitude: number | null
      longitude: number | null
      canonical_place_id: string | null
      match_reason: 'missing-identity' | 'ambiguous' | 'retired' | null
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
       ORDER BY list.source_position, list.source_list_id,
                item.source_position, item.source_item_id`,
      [snapshotId],
    )
    const lists = new Map<string, {
      sourceListId: string
      observedName: string
      sourcePosition: number
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
      if (row.source_item_id !== null) {
        list.items.push({
          sourceItemId: row.source_item_id,
          providerPlaceId: row.provider_place_id,
          observedName: row.observed_name!,
          observedAddress: row.observed_address,
          observedCategory: row.observed_category,
          observedLocation: row.latitude === null || row.longitude === null
            ? null
            : { latitude: row.latitude, longitude: row.longitude },
          match: row.canonical_place_id === null
            ? { status: 'unresolved', reason: row.match_reason! }
            : { status: 'matched', placeId: row.canonical_place_id },
          sourcePosition: row.item_position!,
        })
      }
    }
    const projectedLists = [...lists.values()].map((list) => ({
      ...list,
      itemCount: list.items.length,
      unresolvedItemCount: list.items.filter((item) => item.match.status === 'unresolved').length,
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
      unresolvedItemCount: projectedLists.reduce(
        (sum, list) => sum + list.unresolvedItemCount,
        0,
      ),
      observedAt: header.observed_at.toISOString(),
      capturedAt: header.captured_at.toISOString(),
      lists: projectedLists,
    }
  }
}
