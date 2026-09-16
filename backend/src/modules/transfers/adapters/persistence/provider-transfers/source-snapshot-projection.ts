import type { Pool } from 'pg'

import { snapshotVersion } from '../../../application/identity.js'
import { InvalidTransferCursorError } from '../../../domain/model.js'
import type {
  ImportSourceV1,
  SnapshotItem,
  SnapshotList,
  SourceSnapshotDetailV3,
  SourceSnapshotListV3,
} from '../../../domain/model.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'

type ImportSourceRow = Readonly<{
  source_kind: 'verified-connection' | 'one-shot'
  connection_id: string | null
  acquisition_method: 'shared-link' | 'remote-browser' | null
  authorization_basis: 'link-possession' | 'interactive-provider-session' | null
}>

export function projectImportSource(row: ImportSourceRow & Readonly<{ import_source_id: string }> ):
ImportSourceV1 {
  if (row.source_kind === 'verified-connection') {
    if (row.connection_id === null) throw new Error('verified import source lost its connection')
    return {
      kind: 'verified-connection',
      importSourceId: row.import_source_id,
      connectionId: row.connection_id,
      accountAssurance: 'verified',
    }
  }
  if (row.acquisition_method === null || row.authorization_basis === null) {
    throw new Error('one-shot import source lost its acquisition evidence')
  }
  return {
    kind: 'one-shot',
    importSourceId: row.import_source_id,
    acquisitionMethod: row.acquisition_method,
    authorizationBasis: row.authorization_basis,
    accountAssurance: 'unverified',
  }
}

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

/** Reads the source-neutral V3 snapshot contract without widening the legacy V2 seam. */
export class SourceSnapshotProjection {
  constructor(private readonly context: ProviderTransferContext) {}

  async listV3(input: Readonly<{
    memberId: string
    importSourceId?: string
    cursor?: string
    limit: number
  }>): Promise<SourceSnapshotListV3> {
    const after = decodeCursor(input.cursor)
    if (input.cursor !== undefined && after === undefined) throw new InvalidTransferCursorError()
    const result = await this.context.pool.query<{
      id: string
      content_digest: string
      import_source_id: string
      provider_key: ProviderKey
      source_revision: string
      observed_at: Date
      captured_at: Date
      list_count: number
      item_count: number
      unresolved_count: number
    } & ImportSourceRow>(
      `SELECT snapshot.id, snapshot.content_digest, snapshot.import_source_id,
              snapshot.provider_key, snapshot.source_revision,
              snapshot.observed_at, snapshot.captured_at,
              source.source_kind, source.connection_id,
              source.acquisition_method, source.authorization_basis,
              count(DISTINCT list.source_list_id)::int AS list_count,
              count(item.source_item_id)::int AS item_count,
              count(*) FILTER (
                WHERE item.source_item_id IS NOT NULL AND item.canonical_place_id IS NULL
              )::int AS unresolved_count
       FROM transfers.source_snapshots AS snapshot
       JOIN transfers.import_sources AS source
         ON source.id = snapshot.import_source_id
        AND source.owner_membership_id = snapshot.owner_membership_id
        AND source.provider_key = snapshot.provider_key
        AND source.source_kind = snapshot.import_source_kind
       LEFT JOIN transfers.source_snapshot_lists AS list ON list.snapshot_id = snapshot.id
       LEFT JOIN transfers.source_snapshot_items AS item
         ON item.snapshot_id = list.snapshot_id AND item.source_list_id = list.source_list_id
       WHERE snapshot.owner_membership_id = $1::uuid
         AND ($2::uuid IS NULL OR snapshot.import_source_id = $2::uuid)
         AND ($3::timestamptz IS NULL OR snapshot.captured_at < $3::timestamptz
           OR (snapshot.captured_at = $3::timestamptz AND snapshot.id < $4::uuid))
       GROUP BY snapshot.id, source.source_kind, source.connection_id,
                source.acquisition_method, source.authorization_basis
       ORDER BY snapshot.captured_at DESC, snapshot.id DESC
       LIMIT $5`,
      [input.memberId, input.importSourceId ?? null, after?.capturedAt ?? null,
        after?.snapshotId ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = result.rows.slice(0, input.limit)
    return {
      schemaVersion: 'source-snapshot-list.v3',
      items: rows.map((row) => ({
        snapshotId: row.id,
        snapshotVersion: snapshotVersion(row.id, row.content_digest),
        source: projectImportSource(row),
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

  async getV3(memberId: string, snapshotId: string):
  Promise<SourceSnapshotDetailV3 | undefined> {
    const header = (await this.context.pool.query<{
      id: string
      content_digest: string
      import_source_id: string
      provider_key: ProviderKey
      source_revision: string
      observed_at: Date
      captured_at: Date
    } & ImportSourceRow>(
      `SELECT snapshot.id, snapshot.content_digest, snapshot.import_source_id,
              snapshot.provider_key, snapshot.source_revision,
              snapshot.observed_at, snapshot.captured_at,
              source.source_kind, source.connection_id,
              source.acquisition_method, source.authorization_basis
       FROM transfers.source_snapshots AS snapshot
       JOIN transfers.import_sources AS source
         ON source.id = snapshot.import_source_id
        AND source.owner_membership_id = snapshot.owner_membership_id
        AND source.provider_key = snapshot.provider_key
        AND source.source_kind = snapshot.import_source_kind
       WHERE snapshot.id = $1::uuid AND snapshot.owner_membership_id = $2::uuid`,
      [snapshotId, memberId],
    )).rows[0]
    if (header === undefined) return undefined
    const lists = await readSnapshotLists(this.context.pool, snapshotId)
    return {
      schemaVersion: 'source-snapshot-detail.v3',
      snapshotId: header.id,
      snapshotVersion: snapshotVersion(header.id, header.content_digest),
      source: projectImportSource(header),
      providerKey: header.provider_key,
      sourceRevision: header.source_revision,
      listCount: lists.length,
      itemCount: lists.reduce((sum, list) => sum + list.itemCount, 0),
      unresolvedItemCount: lists.reduce((sum, list) => sum + list.unresolvedItemCount, 0),
      observedAt: header.observed_at.toISOString(),
      capturedAt: header.captured_at.toISOString(),
      lists,
    }
  }
}

/** Shared immutable list projection for connected and one-shot snapshot contracts. */
export async function readSnapshotLists(
  pool: Pool,
  snapshotId: string,
): Promise<readonly SnapshotList[]> {
  const rows = await pool.query<{
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
  return [...lists.values()].map((list) => ({
    ...list,
    itemCount: list.items.length,
    unresolvedItemCount: list.items.filter((item) => item.match.status === 'unresolved').length,
  }))
}
