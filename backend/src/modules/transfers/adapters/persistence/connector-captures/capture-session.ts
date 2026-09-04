import {
  captureManifestDigestInput,
  parseCapturePayload,
  sha256,
} from '../../../application/connector-capture.js'
import { snapshotVersion } from '../../../application/identity.js'
import {
  ConnectorTransferAuthorizationError,
  type ConnectorCapturePayload,
  type ConnectorTransferReceiver,
} from '../../../domain/operations.js'
import {
  ConnectorCaptureContext,
  manifestFrom,
} from './capture-context.js'

export class ConnectorCaptureSession {
  constructor(private readonly context: ConnectorCaptureContext) {}

  async recordChunk(input: Parameters<ConnectorTransferReceiver['recordChunk']>[0]) {
    const byteCount = Buffer.byteLength(input.chunk.payload, 'utf8')
    if (byteCount !== input.chunk.byteCount || sha256(input.chunk.payload) !== input.chunk.checksum) {
      throw new ConnectorTransferAuthorizationError('capture chunk integrity mismatch')
    }
    const payload = parseCapturePayload(input.chunk.payload)
    const itemCount = payload.lists.reduce((sum, list) => sum + list.items.length, 0)
    if (itemCount !== input.chunk.itemCount) {
      throw new ConnectorTransferAuthorizationError('capture item count mismatch')
    }
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const grant = await this.context.authorize(
        client, input.token, input.sourceOrigin, input.chunk.operationId, input.chunk.manifestId,
      )
      if (input.chunk.sequence >= grant.expected_chunk_count ||
        byteCount > grant.maximum_chunk_bytes) {
        throw new ConnectorTransferAuthorizationError('capture chunk exceeds grant')
      }
      const sanitized = JSON.stringify(payload)
      const prior = (await client.query<{
        item_count: number
        byte_count: number
        checksum: string
        payload: unknown
      }>(
        `SELECT item_count, byte_count, checksum, payload
         FROM transfers.connector_capture_chunks
         WHERE manifest_id = $1::uuid AND sequence = $2`,
        [grant.manifest_id, input.chunk.sequence],
      )).rows[0]
      let outcome: 'recorded' | 'replayed' = 'recorded'
      if (prior === undefined) {
        const currentState = await this.context.captureState(client, grant)
        if (input.chunk.sequence !== currentState.nextSequence) {
          throw new ConnectorTransferAuthorizationError('capture chunks must be contiguous')
        }
        const totals = (await client.query<{ items: number; bytes: number }>(
          `SELECT coalesce(sum(item_count),0)::int AS items,
                  coalesce(sum(byte_count),0)::int AS bytes
           FROM transfers.connector_capture_chunks WHERE manifest_id = $1::uuid`,
          [grant.manifest_id],
        )).rows[0]!
        if (totals.items + itemCount > grant.expected_item_count ||
          totals.bytes + byteCount > grant.expected_byte_count) {
          throw new ConnectorTransferAuthorizationError('capture totals exceed manifest')
        }
        await client.query(
          `INSERT INTO transfers.connector_capture_chunks
             (manifest_id, sequence, item_count, byte_count, checksum, payload, received_at)
           VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)`,
          [grant.manifest_id, input.chunk.sequence, itemCount, byteCount,
            input.chunk.checksum, sanitized, this.context.now().toISOString()],
        )
      } else {
        if (prior.item_count !== itemCount || prior.byte_count !== byteCount ||
          prior.checksum !== input.chunk.checksum) {
          throw new ConnectorTransferAuthorizationError('capture sequence reused')
        }
        outcome = 'replayed'
      }
      const state = await this.context.captureState(client, grant)
      await client.query(
        `UPDATE transfers.operations SET stage = 'receiving-chunks', state = 'running',
           processed_count = $2, revision = revision + 1, updated_at = $3::timestamptz
         WHERE id = $1::uuid AND state IN ('queued','running')`,
        [grant.operation_id, state.receivedItems, this.context.now().toISOString()],
      )
      await client.query('COMMIT')
      return {
        outcome,
        operationId: grant.operation_id,
        manifestId: grant.manifest_id,
        acceptedSequence: input.chunk.sequence,
        ...state,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async status(input: Parameters<ConnectorTransferReceiver['status']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const grant = await this.context.authorize(
        client, input.token, input.sourceOrigin, input.operationId, input.manifestId,
      )
      const state = await this.context.captureState(client, grant)
      await client.query('COMMIT')
      return {
        operationId: grant.operation_id,
        manifestId: grant.manifest_id,
        state: grant.status,
        recordedSequences: state.recordedSequences,
        nextSequence: state.nextSequence,
        snapshotId: grant.snapshot_id,
        snapshotVersion: grant.snapshot_id === null
          ? null
          : snapshotVersion(grant.snapshot_id, grant.manifest_digest),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  async complete(input: Parameters<ConnectorTransferReceiver['complete']>[0]) {
    const client = await this.context.pool.connect()
    try {
      await client.query('BEGIN')
      const grant = await this.context.authorize(
        client, input.token, input.sourceOrigin, input.operationId, input.manifest.manifestId,
      )
      if (!this.context.sameManifest(manifestFrom(grant), input.manifest)) {
        throw new ConnectorTransferAuthorizationError('manifest binding mismatch')
      }
      if (grant.status === 'completed') {
        await client.query('COMMIT')
        return {
          outcome: 'replayed' as const,
          operationId: grant.operation_id,
          manifestId: grant.manifest_id,
          missingSequences: [],
          snapshotId: grant.snapshot_id,
          snapshotVersion: snapshotVersion(grant.snapshot_id!, grant.manifest_digest),
        }
      }
      const chunks = await client.query<{
        sequence: number
        item_count: number
        byte_count: number
        checksum: string
        payload: ConnectorCapturePayload
      }>(
        `SELECT sequence, item_count, byte_count, checksum, payload
         FROM transfers.connector_capture_chunks
         WHERE manifest_id = $1::uuid ORDER BY sequence`,
        [grant.manifest_id],
      )
      const sequences = new Set(chunks.rows.map((row) => row.sequence))
      const missingSequences = Array.from(
        { length: grant.expected_chunk_count },
        (_, index) => index,
      ).filter((sequence) => !sequences.has(sequence))
      if (missingSequences.length > 0) {
        await client.query('COMMIT')
        return {
          outcome: 'incomplete' as const,
          operationId: grant.operation_id,
          manifestId: grant.manifest_id,
          missingSequences,
          snapshotId: null,
          snapshotVersion: null,
        }
      }
      const totals = chunks.rows.reduce((value, row) => ({
        items: value.items + row.item_count,
        bytes: value.bytes + row.byte_count,
      }), { items: 0, bytes: 0 })
      if (totals.items !== grant.expected_item_count ||
        totals.bytes !== grant.expected_byte_count) {
        throw new ConnectorTransferAuthorizationError('manifest totals mismatch')
      }
      const digestInput = captureManifestDigestInput({
        operationId: grant.operation_id,
        connectionId: grant.connection_id,
        providerKey: grant.provider_key,
        accountFingerprint: grant.account_fingerprint,
        installationId: grant.installation_id,
        manifest: {
          manifestId: grant.manifest_id,
          sourceRevision: grant.source_revision,
          ...(grant.acquisition_kind === null || grant.parser_version === null
            ? {}
            : { provenance: {
                acquisitionKind: grant.acquisition_kind,
                parserVersion: grant.parser_version,
              } }),
          observedAt: grant.observed_at.toISOString(),
          capturedAt: grant.captured_at.toISOString(),
          chunkCount: grant.expected_chunk_count,
          listCount: grant.expected_list_count,
          itemCount: grant.expected_item_count,
          byteCount: grant.expected_byte_count,
        },
        chunks: chunks.rows.map((row) => ({
          sequence: row.sequence,
          itemCount: row.item_count,
          byteCount: row.byte_count,
          checksum: row.checksum,
        })),
      })
      if (sha256(digestInput) !== grant.manifest_digest) {
        throw new ConnectorTransferAuthorizationError('manifest digest mismatch')
      }
      const lists = this.context.mergeLists(chunks.rows.flatMap((row) => row.payload.lists))
      const actualItems = lists.reduce((sum, list) => sum + list.items.length, 0)
      if (lists.length !== grant.expected_list_count || actualItems !== grant.expected_item_count) {
        throw new ConnectorTransferAuthorizationError('manifest logical counts mismatch')
      }
      const at = this.context.now().toISOString()
      await this.context.insertSnapshot(client, grant, lists, at)
      await client.query(
        `UPDATE transfers.connector_capture_manifests SET status = 'completed',
           snapshot_id = manifest_id, completed_at = $2::timestamptz
         WHERE manifest_id = $1::uuid`,
        [grant.manifest_id, at],
      )
      await client.query(
        `UPDATE transfers.operations SET stage = 'snapshot-recorded', state = 'completed',
           processed_count = total_count, applied_count = total_count, revision = revision + 1,
           updated_at = $2::timestamptz, completed_at = $2::timestamptz WHERE id = $1::uuid`,
        [grant.operation_id, at],
      )
      await client.query('COMMIT')
      return {
        outcome: 'completed' as const,
        operationId: grant.operation_id,
        manifestId: grant.manifest_id,
        missingSequences: [],
        snapshotId: grant.manifest_id,
        snapshotVersion: snapshotVersion(grant.manifest_id, grant.manifest_digest),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }
}
