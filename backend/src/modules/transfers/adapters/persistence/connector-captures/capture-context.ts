import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import { sha256 } from '../../../application/connector-capture.js'
import { transferFingerprint } from '../../../application/identity.js'
import type { TransferCommandResult } from '../../../domain/model.js'
import {
  ConnectorTransferAuthorizationError,
  type ConnectorCapturePayload,
  type ConnectorImportGrant,
  type ConnectorImportGrantRequest,
  type ConnectorManifest,
} from '../../../domain/operations.js'
import { scheduleInitialProviderPlaceDetails } from '../source-snapshot-details/schedule-initial-details.js'

export type ManifestRow = Readonly<{
  manifest_id: string
  operation_id: string
  owner_membership_id: string
  connection_id: string
  provider_key: 'naver' | 'google' | 'kakao'
  account_fingerprint: string
  installation_id: string
  manifest_digest: string
  source_revision: string
  acquisition_kind: NonNullable<ConnectorManifest['provenance']>['acquisitionKind'] | null
  parser_version: string | null
  observed_at: Date
  captured_at: Date
  expected_chunk_count: number
  expected_list_count: number
  expected_item_count: number
  expected_byte_count: number
  maximum_chunk_bytes: number
  status: 'receiving' | 'completed' | 'cancelled' | 'expired'
  snapshot_id: string | null
  operation_state?: string
  cancel_requested?: boolean
}>

export type GrantRow = ManifestRow & Readonly<{
  grant_id: string
  command_id: string
  generation: number
  request_fingerprint: string
  token_digest: string
  place_origin: string
  grant_status: 'active' | 'revoked' | 'expired'
  issued_at: Date
  expires_at: Date
}>

export type ConnectorCaptureOptions = Readonly<{
  grantTtlMilliseconds: number
  maximumChunkBytes: number
  nextId?: () => string
  nextToken?: () => string
  now?: () => Date
}>

export type MergedCaptureList = Readonly<{
  sourceListId: string
  observedName: string
  sourcePosition: number
  items: readonly ConnectorCapturePayload['lists'][number]['items'][number][]
}>

export const grantSelect = `
  SELECT issued_grant.grant_id, issued_grant.command_id, issued_grant.operation_id, issued_grant.generation,
         issued_grant.request_fingerprint, issued_grant.token_digest, issued_grant.place_origin,
         issued_grant.status AS grant_status, issued_grant.issued_at, issued_grant.expires_at,
         manifest.manifest_id, manifest.owner_membership_id, manifest.connection_id,
         manifest.provider_key, manifest.account_fingerprint, manifest.installation_id,
         manifest.manifest_digest, manifest.source_revision, manifest.acquisition_kind,
         manifest.parser_version, manifest.observed_at,
         manifest.captured_at, manifest.expected_chunk_count, manifest.expected_list_count,
         manifest.expected_item_count, manifest.expected_byte_count, manifest.maximum_chunk_bytes,
         manifest.status, manifest.snapshot_id, operation.state AS operation_state,
         operation.cancel_requested
  FROM transfers.connector_import_grants AS issued_grant
  JOIN transfers.connector_capture_manifests AS manifest
    ON manifest.manifest_id = issued_grant.manifest_id
  JOIN transfers.operations AS operation ON operation.id = issued_grant.operation_id`

export function manifestFrom(row: ManifestRow): ConnectorManifest {
  return {
    manifestId: row.manifest_id,
    manifestDigest: row.manifest_digest,
    sourceRevision: row.source_revision,
    ...(row.acquisition_kind === null || row.parser_version === null ? {} : {
      provenance: {
        acquisitionKind: row.acquisition_kind as NonNullable<
          ConnectorManifest['provenance']
        >['acquisitionKind'],
        parserVersion: row.parser_version,
      },
    }),
    observedAt: row.observed_at.toISOString(),
    capturedAt: row.captured_at.toISOString(),
    chunkCount: row.expected_chunk_count,
    listCount: row.expected_list_count,
    itemCount: row.expected_item_count,
    byteCount: row.expected_byte_count,
  }
}

export class ConnectorCaptureContext {
  constructor(
    readonly pool: Pool,
    readonly options: ConnectorCaptureOptions,
  ) {}

  get now() { return this.options.now ?? (() => new Date()) }
  get nextId() { return this.options.nextId ?? randomUUID }
  get nextToken() {
    return this.options.nextToken ?? (() => randomBytes(32).toString('base64url'))
  }

  sameManifest(left: ConnectorManifest, right: ConnectorManifest): boolean {
    return transferFingerprint(left) === transferFingerprint(right)
  }

  projectGrant(
    row: GrantRow,
    token: string,
    issuedAt: Date,
    expiresAt: Date,
  ): ConnectorImportGrant {
    return {
      grantId: row.grant_id,
      operationId: row.operation_id,
      connectionId: row.connection_id,
      providerKey: row.provider_key,
      accountFingerprint: row.account_fingerprint,
      installationId: row.installation_id,
      token,
      placeOrigin: row.place_origin,
      manifest: manifestFrom(row),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      limits: {
        maximumChunks: row.expected_chunk_count,
        maximumItems: row.expected_item_count,
        maximumBytes: row.expected_byte_count,
        maximumChunkBytes: row.maximum_chunk_bytes,
      },
    }
  }

  async authorize(
    client: PoolClient,
    token: string,
    sourceOrigin: string,
    operationId: string,
    manifestId: string,
  ): Promise<GrantRow> {
    const row = (await client.query<GrantRow>(
      `${grantSelect} WHERE issued_grant.token_digest = $1 AND issued_grant.operation_id = $2::uuid
         AND issued_grant.manifest_id = $3::uuid FOR UPDATE`,
      [sha256(token), operationId, manifestId],
    )).rows[0]
    if (row === undefined || row.grant_status !== 'active' || row.place_origin !== sourceOrigin ||
      row.expires_at.getTime() <= this.now().getTime() || row.status === 'cancelled' ||
      row.cancel_requested === true || row.operation_state === 'cancelled') {
      throw new ConnectorTransferAuthorizationError('connector grant is not authorized')
    }
    return row
  }

  async captureState(client: PoolClient, grant: ManifestRow) {
    const rows = await client.query<{ sequence: number; item_count: number; byte_count: number }>(
      `SELECT sequence, item_count, byte_count FROM transfers.connector_capture_chunks
       WHERE manifest_id = $1::uuid ORDER BY sequence`, [grant.manifest_id],
    )
    const recordedSequences = rows.rows.map((row) => row.sequence)
    const seen = new Set(recordedSequences)
    let nextSequence = 0
    while (nextSequence < grant.expected_chunk_count && seen.has(nextSequence)) nextSequence += 1
    return {
      recordedSequences,
      nextSequence,
      receivedChunks: rows.rowCount ?? rows.rows.length,
      receivedItems: rows.rows.reduce((sum, row) => sum + row.item_count, 0),
      receivedBytes: rows.rows.reduce((sum, row) => sum + row.byte_count, 0),
    }
  }

  mergeLists(lists: readonly ConnectorCapturePayload['lists'][number][]): readonly MergedCaptureList[] {
    const byId = new Map<string, {
      observedName: string
      sourcePosition: number
      items: Map<string, ConnectorCapturePayload['lists'][number]['items'][number]>
    }>()
    const positions = new Map<number, string>()
    for (const list of lists) {
      const occupying = positions.get(list.sourcePosition)
      if (occupying !== undefined && occupying !== list.sourceListId) {
        throw new Error('duplicate-list-position')
      }
      positions.set(list.sourcePosition, list.sourceListId)
      let merged = byId.get(list.sourceListId)
      if (merged === undefined) {
        merged = {
          observedName: list.observedName,
          sourcePosition: list.sourcePosition,
          items: new Map(),
        }
        byId.set(list.sourceListId, merged)
      } else if (merged.observedName !== list.observedName ||
        merged.sourcePosition !== list.sourcePosition) {
        throw new Error('inconsistent-list-observation')
      }
      const itemPositions = new Map(
        [...merged.items.values()].map((item) => [item.sourcePosition, item.sourceItemId]),
      )
      for (const item of list.items) {
        if (merged.items.has(item.sourceItemId)) throw new Error('duplicate-source-item')
        if (itemPositions.has(item.sourcePosition)) throw new Error('duplicate-item-position')
        itemPositions.set(item.sourcePosition, item.sourceItemId)
        merged.items.set(item.sourceItemId, item)
      }
    }
    return [...byId.entries()].map(([sourceListId, list]) => ({
      sourceListId,
      observedName: list.observedName,
      sourcePosition: list.sourcePosition,
      items: [...list.items.values()].sort((a, b) => a.sourcePosition - b.sourcePosition),
    })).sort((a, b) => a.sourcePosition - b.sourcePosition)
  }

  async insertSnapshot(
    client: PoolClient,
    grant: GrantRow,
    lists: readonly MergedCaptureList[],
    requestedAt: string,
  ) {
    await client.query(
      `INSERT INTO transfers.source_snapshots (id, owner_membership_id, connection_id,
         provider_key, source_revision, acquisition_kind, parser_version,
         content_digest, observed_at, captured_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)`,
      [grant.manifest_id, grant.owner_membership_id, grant.connection_id, grant.provider_key,
        grant.source_revision, grant.acquisition_kind, grant.parser_version, grant.manifest_digest,
        grant.observed_at.toISOString(), grant.captured_at.toISOString()],
    )
    await client.query(
      `INSERT INTO transfers.source_snapshot_lists
         (snapshot_id, source_list_id, observed_name, source_position)
       SELECT $1::uuid, value.source_list_id, value.observed_name, value.source_position
       FROM jsonb_to_recordset($2::jsonb) AS value(
         source_list_id text, observed_name text, source_position integer
       )`,
      [grant.manifest_id, JSON.stringify(lists.map((list) => ({
        source_list_id: list.sourceListId,
        observed_name: list.observedName,
        source_position: list.sourcePosition,
      })))],
    )
    const items = lists.flatMap((list) => list.items.map((item) => ({
      source_list_id: list.sourceListId,
      source_item_id: item.sourceItemId,
      provider_place_id: item.providerPlaceId,
      observed_name: item.observedName,
      observed_address: item.observedAddress,
      observed_category: item.observedCategory,
      latitude: item.observedLocation?.latitude ?? null,
      longitude: item.observedLocation?.longitude ?? null,
      source_position: item.sourcePosition,
    })))
    await client.query(
      `INSERT INTO transfers.source_snapshot_items (
         snapshot_id, source_list_id, source_item_id, provider_place_id, observed_name,
         observed_address, observed_category, observed_location, canonical_place_id,
         match_reason, source_position
       )
       SELECT $1::uuid, value.source_list_id, value.source_item_id, value.provider_place_id,
              value.observed_name, value.observed_address, value.observed_category,
              CASE WHEN value.latitude IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint(value.longitude, value.latitude),4326) END,
              identity.canonical_place_id,
              CASE WHEN identity.canonical_place_id IS NULL THEN 'missing-identity' ELSE NULL END,
              value.source_position
       FROM jsonb_to_recordset($2::jsonb) AS value(
         source_list_id text, source_item_id text, provider_place_id text, observed_name text,
         observed_address text, observed_category text, latitude double precision,
         longitude double precision, source_position integer
       )
       LEFT JOIN places.provider_place_identities AS identity
         ON identity.provider_key = $3 AND identity.external_place_id = value.provider_place_id`,
      [grant.manifest_id, JSON.stringify(items), grant.provider_key],
    )
    await scheduleInitialProviderPlaceDetails(client, {
      snapshotId: grant.manifest_id,
      providerKey: grant.provider_key,
      requestedAt,
    })
  }

  async reject(
    client: PoolClient,
    request: ConnectorImportGrantRequest,
    code: 'not-found' | 'connection-not-ready' | 'revision-conflict' | 'command-id-reused' |
      'not-approvable',
  ): Promise<TransferCommandResult<ConnectorImportGrant>> {
    await client.query('COMMIT')
    return { status: 'rejected', commandId: request.commandId, rejection: { code } }
  }
}
