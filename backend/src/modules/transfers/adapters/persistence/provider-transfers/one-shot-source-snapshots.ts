import type {
  SourceSnapshotCaptureV3,
} from '../../../domain/model.js'
import type { PoolClient } from 'pg'
import { scheduleInitialProviderPlaceDetails } from '../source-snapshot-details/schedule-initial-details.js'
import {
  ProviderTransferContext,
  type ProviderKey,
} from './provider-transfer-context.js'
import { SourceSnapshotProjection } from './source-snapshot-projection.js'

type OneShotSourceRow = Readonly<{
  acquisition_method: 'shared-link' | 'remote-browser'
  authorization_basis: 'link-possession' | 'interactive-provider-session'
}>

/** Shared transaction implementation used by ordinary and lease-fenced one-shot writers. */
export async function recordOneShotSourceSnapshot(
  client: Pick<PoolClient, 'query'>,
  context: Pick<ProviderTransferContext, 'fingerprint' | 'now'>,
  input: SourceSnapshotCaptureV3,
): Promise<'applied' | 'replayed'> {
  if (input.lists.length > 50 || input.lists.some((list) => list.items.length > 500) ||
    input.lists.reduce((count, list) => count + list.items.length, 0) > 10_000) {
    throw new Error('source snapshot exceeds bounded projection limits')
  }
  const digest = context.fingerprint({
    source: input.source,
    providerKey: input.providerKey,
    sourceRevision: input.sourceRevision,
    provenance: input.provenance,
    observedAt: input.observedAt,
    capturedAt: input.capturedAt,
    lists: input.lists,
  })
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('gotgotgan.snapshot.v3:' || $1, 0))",
    [input.snapshotId],
  )
  const prior = (await client.query<{ content_digest: string }>(
    `SELECT content_digest FROM transfers.source_snapshots
     WHERE id = $1::uuid AND owner_membership_id = $2::uuid
       AND import_source_kind = 'one-shot'`,
    [input.snapshotId, input.ownerMemberId],
  )).rows[0]
  if (prior !== undefined) {
    if (prior.content_digest !== digest) throw new Error('source snapshot identity reused')
    return 'replayed'
  }
  const source = (await client.query<OneShotSourceRow>(
    `SELECT acquisition_method, authorization_basis
     FROM transfers.import_sources
     WHERE id = $1::uuid AND owner_membership_id = $2::uuid
       AND provider_key = $3 AND source_kind = 'one-shot'`,
    [input.source.importSourceId, input.ownerMemberId, input.providerKey],
  )).rows[0]
  if (source === undefined || source.acquisition_method !== input.source.acquisitionMethod ||
    source.authorization_basis !== input.source.authorizationBasis) {
    throw new Error('one-shot import source is unavailable')
  }
  await client.query(
    `INSERT INTO transfers.source_snapshots (
       id, owner_membership_id, connection_id, provider_key,
       import_source_id, import_source_kind, source_revision,
       acquisition_kind, parser_version, content_digest, observed_at, captured_at
     ) VALUES ($1::uuid,$2::uuid,NULL,$3,$4::uuid,'one-shot',$5,$6,$7,$8,
       $9::timestamptz,$10::timestamptz)`,
    [input.snapshotId, input.ownerMemberId, input.providerKey,
      input.source.importSourceId, input.sourceRevision,
      input.provenance.acquisitionKind, input.provenance.parserVersion,
      digest, input.observedAt, input.capturedAt],
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
  await scheduleInitialProviderPlaceDetails(client, {
    snapshotId: input.snapshotId,
    providerKey: input.providerKey,
    requestedAt: context.now().toISOString(),
  })
  return 'applied'
}

/** Persists account-unverified snapshots without entering the Connector grant boundary. */
export class OneShotSourceSnapshots {
  private readonly projection: SourceSnapshotProjection

  constructor(private readonly context: ProviderTransferContext) {
    this.projection = new SourceSnapshotProjection(context)
  }

  async record(input: SourceSnapshotCaptureV3) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const status = await recordOneShotSourceSnapshot(client, this.context, input)
      await client.query('COMMIT')
      const snapshot = await this.projection.getV3(input.ownerMemberId, input.snapshotId)
      if (snapshot === undefined) throw new Error('source snapshot did not persist')
      return { status, snapshot }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

}
