import type { Pool } from 'pg'

import type {
  ImportReviewResult,
  ImportReviewStore,
  ReviewableImportItem,
} from '../../application/ports/import-review-store.js'
import {
  ImportReferenceUnavailableError,
  type PlaceImportItem,
} from '../../domain/imports.js'
import {
  iso,
  isUniqueViolation,
  refreshBatchProgress,
} from './postgres-import-common.js'

export class PostgresImportReview implements ImportReviewStore {
  constructor(private readonly pool: Pool) {}

  async beginReview(input: Parameters<ImportReviewStore['beginReview']>[0]) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<{
        item_id: string
        batch_id: string
        member_id: string
        connection_id: string
        provider_key: 'naver' | 'kakao' | 'google'
        provider_place_id: string | null
        source_list_id: string
        source_item_id: string
        source_list_position: number
        source_position: number
        list_name: string
        display_name: string
        address: string | null
        category_label: string | null
        latitude: number | null
        longitude: number | null
        item_status: PlaceImportItem['status']
        observation_id: string
        candidate_id: string
        decision_id: string
        proposed_place_id: string
        artifact_reference: string
        payload_checksum: string
        parser_version: string
        acquisition_kind: ReviewableImportItem['capture']['acquisitionKind']
        observed_at: string | Date
      }>(
        `SELECT imported.id AS item_id, imported.batch_id, batch.member_id,
                batch.connection_id, batch.provider_key, imported.provider_place_id,
                imported.source_list_id, imported.source_item_id, imported.source_list_position,
                imported.source_position,
                imported.list_name, imported.display_name,
                imported.address, imported.category_label, imported.status AS item_status,
                imported.observation_id, imported.candidate_id, imported.decision_id,
                imported.proposed_place_id, capture.artifact_reference,
                capture.payload_checksum, capture.parser_version, capture.acquisition_kind,
                capture.observed_at,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_Y(imported.location) END AS latitude,
                CASE WHEN imported.location IS NULL THEN NULL ELSE ST_X(imported.location) END AS longitude
         FROM ingestion.import_items AS imported
         JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
         JOIN ingestion.import_capture_artifacts AS capture ON capture.id = imported.capture_id
         WHERE imported.id = $1::uuid AND batch.member_id = $2::uuid
         FOR UPDATE OF imported`,
        [input.itemId, input.memberId],
      )
      const row = selected.rows[0]
      if (row === undefined) {
        await client.query('ROLLBACK')
        return { status: 'not-found' as const }
      }
      const receipt = await client.query<{
        command_id: string
        member_id: string
        item_id: string
        request_fingerprint: string
        action_kind: string
        outcome_status: 'pending' | 'applied' | 'skipped'
        canonical_place_id: string | null
      }>(
        `SELECT command_id, member_id, item_id, request_fingerprint, action_kind,
                outcome_status, canonical_place_id
         FROM ingestion.import_review_receipts
         WHERE item_id = $1::uuid OR command_id = $2::uuid
         FOR UPDATE`,
        [input.itemId, input.commandId],
      )
      const prior = receipt.rows[0]
      if (prior !== undefined) {
        const same = prior.command_id === input.commandId &&
          prior.member_id === input.memberId &&
          prior.item_id === input.itemId &&
          prior.request_fingerprint === input.requestFingerprint &&
          prior.action_kind === input.actionKind
        if (!same) {
          await client.query('ROLLBACK')
          return { status: 'conflict' as const }
        }
        if (prior.outcome_status !== 'pending') {
          await client.query('COMMIT')
          return {
            status: 'replayed' as const,
            result: {
              status: 'replayed' as const,
              commandId: prior.command_id,
              itemId: prior.item_id,
              ...(prior.canonical_place_id === null
                ? {}
                : { canonicalPlaceId: prior.canonical_place_id }),
            },
          }
        }
      } else {
        if (row.item_status !== 'ready' && row.item_status !== 'needs-review') {
          await client.query('ROLLBACK')
          return { status: 'conflict' as const }
        }
        if (input.actionKind !== 'skip' && row.provider_place_id === null) {
          await client.query('ROLLBACK')
          return { status: 'invalid' as const }
        }
        await client.query(
          `INSERT INTO ingestion.import_review_receipts (
             command_id, member_id, item_id, request_fingerprint, action_kind,
             outcome_status, created_at
           ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'pending',$6::timestamptz)`,
          [input.commandId, input.memberId, input.itemId, input.requestFingerprint,
            input.actionKind, input.occurredAt],
        )
      }
      const reviewable: ReviewableImportItem = {
        itemId: row.item_id,
        batchId: row.batch_id,
        memberId: row.member_id,
        connectionId: row.connection_id,
        providerKey: row.provider_key,
        ...(row.provider_place_id === null ? {} : { providerPlaceId: row.provider_place_id }),
        sourceListId: row.source_list_id,
        sourceItemId: row.source_item_id,
        sourceListPosition: row.source_list_position,
        sourcePosition: row.source_position,
        listName: row.list_name,
        name: row.display_name,
        address: row.address,
        categoryLabel: row.category_label,
        location: row.latitude === null || row.longitude === null
          ? null
          : { latitude: row.latitude, longitude: row.longitude },
        observationId: row.observation_id,
        candidateId: row.candidate_id,
        decisionId: row.decision_id,
        proposedPlaceId: row.proposed_place_id,
        capture: {
          reference: row.artifact_reference,
          checksum: row.payload_checksum,
          parserVersion: row.parser_version,
          acquisitionKind: row.acquisition_kind,
          observedAt: iso(row.observed_at),
        },
      }
      await client.query('COMMIT')
      return { status: 'ready' as const, item: reviewable }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (isUniqueViolation(error)) return { status: 'conflict' as const }
      throw error
    } finally {
      client.release()
    }
  }

  async completeReview(
    input: Parameters<ImportReviewStore['completeReview']>[0],
  ): Promise<ImportReviewResult> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const receipt = await client.query<{
        outcome_status: 'pending' | 'applied' | 'skipped'
        canonical_place_id: string | null
        batch_id: string
      }>(
        `SELECT receipt.outcome_status, receipt.canonical_place_id, imported.batch_id
         FROM ingestion.import_review_receipts AS receipt
         JOIN ingestion.import_items AS imported ON imported.id = receipt.item_id
         WHERE receipt.command_id = $1::uuid AND receipt.member_id = $2::uuid
           AND receipt.item_id = $3::uuid
         FOR UPDATE OF receipt, imported`,
        [input.commandId, input.memberId, input.itemId],
      )
      const prior = receipt.rows[0]
      if (prior === undefined) throw new ImportReferenceUnavailableError('Review receipt is unavailable.')
      if (prior.outcome_status !== 'pending') {
        await client.query('COMMIT')
        return {
          status: 'replayed',
          commandId: input.commandId,
          itemId: input.itemId,
          ...(prior.canonical_place_id === null
            ? {}
            : { canonicalPlaceId: prior.canonical_place_id }),
        }
      }
      await client.query(
        `UPDATE ingestion.import_items
         SET status = $2, canonical_place_id = $3::uuid, updated_at = $4::timestamptz
         WHERE id = $1::uuid`,
        [input.itemId, input.status, input.canonicalPlaceId ?? null, input.completedAt],
      )
      await client.query(
        `UPDATE ingestion.import_review_receipts
         SET outcome_status = $2, canonical_place_id = $3::uuid, completed_at = $4::timestamptz
         WHERE command_id = $1::uuid`,
        [input.commandId, input.status, input.canonicalPlaceId ?? null, input.completedAt],
      )
      await refreshBatchProgress(client, prior.batch_id, input.completedAt)
      await client.query('COMMIT')
      return {
        status: input.status,
        commandId: input.commandId,
        itemId: input.itemId,
        ...(input.canonicalPlaceId === undefined
          ? {}
          : { canonicalPlaceId: input.canonicalPlaceId }),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
