import type { Pool, PoolClient } from 'pg'

import type {
  ExpiredImportCapture,
  ImportCaptureRetentionStore,
} from '../../application/ports/import-capture-retention-store.js'
import type { ConnectorImportStore } from '../../application/ports/connector-import-store.js'
import type {
  ProviderConnectionRegistration,
  ProviderConnectionStore,
} from '../../application/ports/provider-connection-store.js'
import type { ProviderConnectionProjection } from '../../domain/imports.js'
import {
  insertPreparedImportItems,
  iso,
  isUniqueViolation,
  updateImportBatchAfterCapture,
} from './postgres-import-common.js'

type ConnectorOperationRow = Readonly<{
  id: string
  member_id: string
  import_batch_id: string
  provider_key: 'naver' | 'kakao' | 'google'
  request_fingerprint: string
  place_origin: string
  maximum_items: number
  maximum_bytes: number
  maximum_batches: number
  maximum_batch_bytes: number
  next_sequence: number
  received_items: number
  received_bytes: number
  state: 'receiving' | 'completed' | 'revoked'
  expires_at: string | Date
}>

type ConnectorReceiptRow = Readonly<{
  operation_id: string
  sequence: number
  capture_id: string
  checksum: string
  item_count: number
  byte_count: number
  final: boolean
  state: 'pending' | 'committed'
  cumulative_items: number | null
  cumulative_bytes: number | null
  retained_until: string | Date
  import_batch_id: string
}>

function connectorReceipt(row: ConnectorReceiptRow) {
  if (row.cumulative_items === null || row.cumulative_bytes === null) {
    throw new Error('Connector receipt is not committed')
  }
  return {
    schemaVersion: 'place-connector-capture-receipt.v1' as const,
    operationId: row.operation_id,
    acceptedSequence: row.sequence,
    acceptedChecksum: row.checksum,
    receivedItems: row.cumulative_items,
    receivedBytes: row.cumulative_bytes,
    importBatchId: row.import_batch_id,
  }
}

export class PostgresConnectorImports implements
  ProviderConnectionStore,
  ImportCaptureRetentionStore,
  ConnectorImportStore {
  constructor(private readonly pool: Pool) {}

  async registerConnection(command: ProviderConnectionRegistration) {
    const inserted = await this.pool.query(
      `INSERT INTO ingestion.provider_connections (
         id, member_id, provider_key, label, status, secret_reference, profile_reference,
         last_verified_at, created_at, updated_at
       ) VALUES ($1::uuid,$2::uuid,$3,$4,'ready',$5,$6,$7::timestamptz,$7::timestamptz,$7::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [command.connectionId, command.memberId, command.providerKey, command.label,
        command.secretReference ?? null, command.profileReference ?? null, command.registeredAt],
    )
    if (inserted.rowCount === 1) return 'registered' as const
    const existing = await this.pool.query<{
      member_id: string
      provider_key: string
      label: string
      secret_reference: string | null
      profile_reference: string | null
    }>(
      `SELECT member_id, provider_key, label, secret_reference, profile_reference
       FROM ingestion.provider_connections WHERE id = $1::uuid`,
      [command.connectionId],
    )
    const row = existing.rows[0]
    return row !== undefined &&
      row.member_id === command.memberId &&
      row.provider_key === command.providerKey &&
      row.label === command.label &&
      row.secret_reference === (command.secretReference ?? null) &&
      row.profile_reference === (command.profileReference ?? null)
      ? 'replayed' as const
      : 'conflict' as const
  }

  async listConnections(memberId: string): Promise<readonly ProviderConnectionProjection[]> {
    const result = await this.pool.query<{
      id: string
      provider_key: 'naver' | 'kakao' | 'google'
      label: string
      status: 'ready' | 'action-required' | 'revoked'
      last_verified_at: string | Date | null
    }>(
      `SELECT id, provider_key, label, status, last_verified_at
       FROM ingestion.provider_connections
       WHERE member_id = $1::uuid
       ORDER BY created_at, id`,
      [memberId],
    )
    return result.rows.map((row) => ({
      connectionId: row.id,
      providerKey: row.provider_key,
      label: row.label,
      status: row.status,
      lastVerifiedAt: row.last_verified_at === null ? null : iso(row.last_verified_at),
    }))
  }

  async findExpired(input: Readonly<{
    expiredAt: string
    limit: number
  }>): Promise<readonly ExpiredImportCapture[]> {
    const selected = await this.pool.query<{
      id: string
      batch_id: string
      provider_key: 'naver' | 'kakao' | 'google'
      artifact_reference: string
    }>(
      `SELECT capture.id, capture.batch_id, batch.provider_key, capture.artifact_reference
       FROM ingestion.import_capture_artifacts AS capture
       JOIN ingestion.import_batches AS batch ON batch.id = capture.batch_id
       WHERE capture.retained_until <= $1::timestamptz AND capture.deleted_at IS NULL
       ORDER BY capture.retained_until, capture.id
       LIMIT $2`,
      [input.expiredAt, input.limit],
    )
    return selected.rows.map((row) => ({
      captureId: row.id,
      batchId: row.batch_id,
      providerKey: row.provider_key,
      artifactReference: row.artifact_reference,
    }))
  }

  async markDeleted(input: Readonly<{
    captureId: string
    deletedAt: string
  }>): Promise<'marked' | 'already-deleted'> {
    const updated = await this.pool.query(
      `UPDATE ingestion.import_capture_artifacts
       SET deleted_at = $2::timestamptz
       WHERE id = $1::uuid AND deleted_at IS NULL AND retained_until <= $2::timestamptz`,
      [input.captureId, input.deletedAt],
    )
    return updated.rowCount === 1 ? 'marked' : 'already-deleted'
  }

  async issueGrant(command: Parameters<ConnectorImportStore['issueGrant']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const prior = await client.query<ConnectorOperationRow>(
        `SELECT * FROM ingestion.connector_import_operations
         WHERE member_id = $1::uuid AND idempotency_key = $2::uuid
         FOR UPDATE`,
        [command.memberId, command.idempotencyKey],
      )
      const existing = prior.rows[0]
      if (existing !== undefined) {
        if (existing.request_fingerprint !== command.requestFingerprint) {
          await client.query('ROLLBACK')
          return { status: 'conflict' as const }
        }
        if (existing.state !== 'receiving') {
          await client.query('ROLLBACK')
          return { status: 'closed' as const }
        }
        await client.query(
          `UPDATE ingestion.connector_import_operations
           SET token_digest = $2, expires_at = $3::timestamptz, updated_at = $4::timestamptz
           WHERE id = $1::uuid`,
          [existing.id, command.tokenDigest, command.expiresAt, command.issuedAt],
        )
        await client.query('COMMIT')
        return {
          status: 'replayed' as const,
          operationId: existing.id,
          importBatchId: existing.import_batch_id,
        }
      }

      const profileReference = `connector:${command.installationId}`
      const connection = await client.query<{ id: string }>(
        `INSERT INTO ingestion.provider_connections AS connection (
           id, member_id, provider_key, label, status, profile_reference, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'ready',$5,$6::timestamptz,$6::timestamptz)
         ON CONFLICT (member_id, provider_key, profile_reference)
           WHERE profile_reference LIKE 'connector:%'
         DO UPDATE SET label = EXCLUDED.label, status = 'ready', revoked_at = NULL,
                       updated_at = EXCLUDED.updated_at
         RETURNING connection.id`,
        [command.connectionId, command.memberId, command.providerKey,
          `${command.providerKey.toUpperCase()} 브라우저 가져오기`, profileReference, command.issuedAt],
      )
      const connectionId = connection.rows[0]!.id
      await client.query(
        `INSERT INTO ingestion.import_batches (
           id, member_id, connection_id, provider_key, idempotency_key,
           request_fingerprint, state, created_at, updated_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,'running',$7::timestamptz,$7::timestamptz)`,
        [command.batchId, command.memberId, connectionId, command.providerKey,
          command.idempotencyKey, command.requestFingerprint, command.issuedAt],
      )
      await client.query(
        `INSERT INTO ingestion.connector_import_operations (
           id, member_id, connection_id, import_batch_id, installation_id,
           browser_key, provider_key, operation_kind, idempotency_key,
           request_fingerprint, token_digest, place_origin,
           maximum_items, maximum_bytes, maximum_batches, maximum_batch_bytes,
           state, expires_at, created_at, updated_at
         ) VALUES (
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,
           $6,$7,'import-saved-library',$8::uuid,$9,$10,$11,
           $12,$13,$14,$15,'receiving',$16::timestamptz,$17::timestamptz,$17::timestamptz
         )`,
        [command.operationId, command.memberId, connectionId, command.batchId,
          command.installationId, command.browserKey, command.providerKey,
          command.idempotencyKey, command.requestFingerprint, command.tokenDigest,
          command.placeOrigin, command.limits.maximumItems, command.limits.maximumBytes,
          command.limits.maximumBatches, command.limits.maximumBatchBytes,
          command.expiresAt, command.issuedAt],
      )
      await client.query('COMMIT')
      return {
        status: 'created' as const,
        operationId: command.operationId,
        importBatchId: command.batchId,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) return { status: 'conflict' as const }
      throw error
    } finally {
      client.release()
    }
  }

  async beginCapture(command: Parameters<ConnectorImportStore['beginCapture']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<ConnectorOperationRow>(
        `SELECT * FROM ingestion.connector_import_operations
         WHERE id = $1::uuid AND token_digest = $2
         FOR UPDATE`,
        [command.operationId, command.tokenDigest],
      )
      const operation = selected.rows[0]
      if (operation === undefined) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'invalid-grant' as const }
      }
      if (new Date(operation.expires_at).getTime() <= new Date(command.reservedAt).getTime()) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'grant-expired' as const }
      }
      if (operation.place_origin !== command.placeOrigin) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'origin-mismatch' as const }
      }
      if (operation.provider_key !== command.providerKey) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'operation-conflict' as const }
      }
      const receipt = await client.query<ConnectorReceiptRow>(
        `SELECT receipt.*, capture.retained_until, operation.import_batch_id
         FROM ingestion.connector_capture_receipts AS receipt
         JOIN ingestion.import_capture_artifacts AS capture ON capture.id = receipt.capture_id
         JOIN ingestion.connector_import_operations AS operation ON operation.id = receipt.operation_id
         WHERE receipt.operation_id = $1::uuid AND receipt.sequence = $2`,
        [command.operationId, command.sequence],
      )
      const prior = receipt.rows[0]
      if (command.sequence < operation.next_sequence) {
        if (prior?.state !== 'committed' || prior.checksum !== command.checksum) {
          await client.query('ROLLBACK')
          return { status: 'rejected' as const, reason: 'operation-conflict' as const }
        }
        await client.query('COMMIT')
        return { status: 'replayed' as const, receipt: connectorReceipt(prior) }
      }
      if (operation.state !== 'receiving' || command.sequence !== operation.next_sequence) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'operation-conflict' as const }
      }
      if (prior !== undefined) {
        if (
          prior.state !== 'pending' || prior.checksum !== command.checksum ||
          prior.item_count !== command.itemCount || prior.byte_count !== command.byteCount ||
          prior.final !== command.final
        ) {
          await client.query('ROLLBACK')
          return { status: 'rejected' as const, reason: 'operation-conflict' as const }
        }
        await client.query('COMMIT')
        return {
          status: 'pending' as const,
          artifactId: prior.capture_id,
          importBatchId: operation.import_batch_id,
          retentionUntil: iso(prior.retained_until),
        }
      }
      if (
        command.byteCount > operation.maximum_batch_bytes ||
        operation.received_items + command.itemCount > operation.maximum_items ||
        operation.received_bytes + command.byteCount > operation.maximum_bytes ||
        command.sequence + 1 > operation.maximum_batches
      ) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'limit-exceeded' as const }
      }
      await client.query(
        `INSERT INTO ingestion.import_capture_artifacts (
           id, batch_id, artifact_reference, payload_checksum, parser_version,
           acquisition_kind, observed_at, retained_until, created_at
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz)`,
        [command.artifactId, operation.import_batch_id, command.artifactReference,
          command.checksum, command.parserVersion, command.acquisitionKind,
          command.observedAt, command.retentionUntil, command.reservedAt],
      )
      await client.query(
        `INSERT INTO ingestion.connector_capture_receipts (
           operation_id, sequence, capture_id, checksum, item_count,
           byte_count, final, state, created_at
         ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,'pending',$8::timestamptz)`,
        [command.operationId, command.sequence, command.artifactId, command.checksum,
          command.itemCount, command.byteCount, command.final, command.reservedAt],
      )
      await client.query('COMMIT')
      return {
        status: 'pending' as const,
        artifactId: command.artifactId,
        importBatchId: operation.import_batch_id,
        retentionUntil: command.retentionUntil,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) {
        return { status: 'rejected' as const, reason: 'operation-conflict' as const }
      }
      throw error
    } finally {
      client.release()
    }
  }

  async commitCapture(command: Parameters<ConnectorImportStore['commitCapture']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<ConnectorOperationRow>(
        `SELECT * FROM ingestion.connector_import_operations
         WHERE id = $1::uuid AND token_digest = $2
         FOR UPDATE`,
        [command.operationId, command.tokenDigest],
      )
      const operation = selected.rows[0]
      if (operation === undefined) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'invalid-grant' as const }
      }
      const receiptResult = await client.query<ConnectorReceiptRow>(
        `SELECT receipt.*, capture.retained_until, operation.import_batch_id
         FROM ingestion.connector_capture_receipts AS receipt
         JOIN ingestion.import_capture_artifacts AS capture ON capture.id = receipt.capture_id
         JOIN ingestion.connector_import_operations AS operation ON operation.id = receipt.operation_id
         WHERE receipt.operation_id = $1::uuid AND receipt.sequence = $2
         FOR UPDATE OF receipt`,
        [command.operationId, command.sequence],
      )
      const receipt = receiptResult.rows[0]
      if (receipt?.state === 'committed' && receipt.checksum === command.checksum) {
        await client.query('COMMIT')
        return { status: 'replayed' as const, receipt: connectorReceipt(receipt) }
      }
      if (
        operation.state !== 'receiving' || operation.next_sequence !== command.sequence ||
        receipt === undefined || receipt.state !== 'pending' ||
        receipt.checksum !== command.checksum || receipt.item_count !== command.items.length
      ) {
        await client.query('ROLLBACK')
        return { status: 'rejected' as const, reason: 'operation-conflict' as const }
      }
      await insertPreparedImportItems(client, {
        batchId: operation.import_batch_id,
        captureId: receipt.capture_id,
        providerKey: operation.provider_key,
        items: command.items,
        recordedAt: command.committedAt,
      })
      const receivedItems = operation.received_items + receipt.item_count
      const receivedBytes = operation.received_bytes + receipt.byte_count
      await client.query(
        `UPDATE ingestion.connector_capture_receipts
         SET state = 'committed', cumulative_items = $3, cumulative_bytes = $4,
             committed_at = $5::timestamptz
         WHERE operation_id = $1::uuid AND sequence = $2`,
        [command.operationId, command.sequence, receivedItems, receivedBytes, command.committedAt],
      )
      await client.query(
        `UPDATE ingestion.connector_import_operations
         SET next_sequence = next_sequence + 1, received_items = $2, received_bytes = $3,
             state = CASE WHEN $4 THEN 'completed' ELSE 'receiving' END,
             completed_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
             updated_at = $5::timestamptz
         WHERE id = $1::uuid`,
        [command.operationId, receivedItems, receivedBytes, receipt.final, command.committedAt],
      )
      await updateImportBatchAfterCapture(
        client, operation.import_batch_id, receipt.final, command.committedAt,
      )
      await client.query('COMMIT')
      return {
        status: 'committed' as const,
        receipt: connectorReceipt({
          ...receipt,
          state: 'committed',
          cumulative_items: receivedItems,
          cumulative_bytes: receivedBytes,
        }),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
