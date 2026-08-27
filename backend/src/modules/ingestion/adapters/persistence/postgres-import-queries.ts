import type { Pool } from 'pg'

import {
  decodeImportBatchCursor,
  decodeImportItemCursor,
  encodeImportBatchCursor,
  encodeImportItemCursor,
} from '../../application/import-cursor.js'
import type { ImportQueries } from '../../application/import-queries.js'
import { InvalidImportQueryError } from '../../domain/import-queries.js'
import {
  type BatchRow,
  type ItemRow,
  batch,
  item,
} from './postgres-import-common.js'

type OrderedItemRow = ItemRow & Readonly<{
  source_list_position: number
  source_position: number
}>

function requireLimit(limit: number, maximum: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new InvalidImportQueryError(`Import query limit must be between 1 and ${maximum}.`)
  }
}

export class PostgresImportQueries implements ImportQueries {
  constructor(private readonly pool: Pool) {}

  async listBatches(input: Parameters<ImportQueries['listBatches']>[0]) {
    requireLimit(input.limit, 50)
    const cursor = decodeImportBatchCursor(input.cursor, input.state)
    const result = await this.pool.query<BatchRow>(
      `
        SELECT *
        FROM ingestion.import_batches
        WHERE member_id = $1::uuid
          AND ($2::text = 'all' OR state = $2::text)
          AND (
            $3::timestamptz IS NULL
            OR created_at < $3::timestamptz
            OR (created_at = $3::timestamptz AND id > $4::uuid)
          )
        ORDER BY created_at DESC, id ASC
        LIMIT $5
      `,
      [input.memberId, input.state, cursor?.createdAt ?? null,
        cursor?.batchId ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const last = rows.at(-1)
    return {
      schemaVersion: 'place-import-batch-list.v1' as const,
      filter: { state: input.state },
      items: rows.map(batch),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeImportBatchCursor(input.state, {
          createdAt: new Date(last.created_at).toISOString(),
          batchId: last.id,
        }),
      } : {}),
    }
  }

  async getBatch(input: Parameters<ImportQueries['getBatch']>[0]) {
    requireLimit(input.limit, 200)
    const cursor = decodeImportItemCursor(input.cursor, input.batchId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const selected = await client.query<BatchRow>(
        'SELECT * FROM ingestion.import_batches WHERE id = $1::uuid AND member_id = $2::uuid',
        [input.batchId, input.memberId],
      )
      const batchRow = selected.rows[0]
      if (batchRow === undefined) {
        await client.query('COMMIT')
        return undefined
      }
      const result = await client.query<OrderedItemRow>(
        `
          SELECT imported.id, imported.batch_id, batch.provider_key,
                 imported.provider_place_id, imported.source_list_id,
                 imported.source_item_id, imported.source_list_position,
                 imported.source_position, imported.list_name, imported.display_name,
                 imported.address, imported.category_label, imported.status,
                 imported.review_reasons, imported.canonical_place_id,
                 CASE
                   WHEN imported.provider_place_id IS NULL THEN 'unavailable'
                   ELSE coalesce(detail.status, 'pending')
                 END AS detail_status,
                 CASE WHEN imported.location IS NULL THEN NULL
                   ELSE ST_Y(imported.location) END AS latitude,
                 CASE WHEN imported.location IS NULL THEN NULL
                   ELSE ST_X(imported.location) END AS longitude
          FROM ingestion.import_items AS imported
          JOIN ingestion.import_batches AS batch ON batch.id = imported.batch_id
          LEFT JOIN ingestion.provider_place_detail_statuses AS detail
            ON detail.provider_key = batch.provider_key
           AND detail.provider_place_id = imported.provider_place_id
          WHERE imported.batch_id = $1::uuid
            AND (
              $2::int IS NULL
              OR imported.source_list_position > $2::int
              OR (
                imported.source_list_position = $2::int
                AND imported.source_position > $3::int
              )
              OR (
                imported.source_list_position = $2::int
                AND imported.source_position = $3::int
                AND imported.id > $4::uuid
              )
            )
          ORDER BY imported.source_list_position, imported.source_position, imported.id
          LIMIT $5
        `,
        [input.batchId, cursor?.sourceListPosition ?? null,
          cursor?.sourcePosition ?? null, cursor?.itemId ?? null, input.limit + 1],
      )
      await client.query('COMMIT')
      const hasMore = result.rows.length > input.limit
      const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
      const last = rows.at(-1)
      return {
        schemaVersion: 'place-import-batch-detail.v1' as const,
        batch: batch(batchRow),
        items: rows.map(item),
        ...(hasMore && last !== undefined ? {
          nextCursor: encodeImportItemCursor(input.batchId, {
            sourceListPosition: last.source_list_position,
            sourcePosition: last.source_position,
            itemId: last.id,
          }),
        } : {}),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
