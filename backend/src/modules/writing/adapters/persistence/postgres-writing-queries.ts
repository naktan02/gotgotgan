import type { Pool } from 'pg'

import { decodeWritingCursor, encodeWritingCursor } from '../../application/writing-cursor.js'
import type { WritingQueries } from '../../application/writing-queries.js'
import { InvalidWritingQueryError, type WritingDocument } from '../../domain/queries.js'

type WritingRow = Readonly<{
  id: string
  kind: 'note' | 'entry'
  title: string | null
  body: string
  visibility: 'private' | 'unlisted' | 'public'
  publication_id: string | null
  version: string
  created_at: Date
  updated_at: Date
  place_ids: string[]
}>

type WritingListRow = WritingRow & Readonly<{
  body_preview: string
  body_truncated: boolean
}>

function requireBoundedLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidWritingQueryError('Writing query limit must be between 1 and 50.')
  }
}

function document(row: WritingRow): WritingDocument {
  const common = {
    documentId: row.id,
    body: row.body,
    visibility: row.visibility,
    publicationId: row.publication_id,
    version: Number(row.version),
    placeIds: row.place_ids,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
  return row.kind === 'entry'
    ? { kind: 'entry', title: row.title!, ...common }
    : { kind: 'note', title: null, ...common }
}

export class PostgresWritingQueries implements WritingQueries {
  constructor(private readonly pool: Pool) {}

  async list(input: Parameters<WritingQueries['list']>[0]) {
    requireBoundedLimit(input.limit)
    const cursor = decodeWritingCursor(input.cursor, input.kind)
    const result = await this.pool.query<WritingListRow>(
      `
        SELECT
          document.id,
          document.kind,
          document.title,
          document.body,
          left(document.body, 280) AS body_preview,
          length(document.body) > 280 AS body_truncated,
          document.visibility,
          document.publication_id,
          document.version,
          document.created_at,
          document.updated_at,
          ARRAY(
            SELECT link.canonical_place_id
            FROM writing.document_place_links AS link
            WHERE link.document_id = document.id
            ORDER BY link.position
          ) AS place_ids
        FROM writing.documents AS document
        WHERE document.owner_membership_id = $1::uuid
          AND ($2::text = 'all' OR document.kind = $2::text)
          AND (
            $3::timestamptz IS NULL
            OR document.updated_at < $3::timestamptz
            OR (document.updated_at = $3::timestamptz AND document.id > $4::uuid)
          )
        ORDER BY document.updated_at DESC, document.id ASC
        LIMIT $5
      `,
      [input.memberId, input.kind, cursor?.updatedAt ?? null,
        cursor?.documentId ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const last = rows.at(-1)
    return {
      schemaVersion: 'writing-list.v1' as const,
      filter: { kind: input.kind },
      items: rows.map((row) => {
        const common = {
          documentId: row.id,
          bodyPreview: row.body_preview,
          bodyTruncated: row.body_truncated,
          visibility: row.visibility,
          publicationId: row.publication_id,
          version: Number(row.version),
          placeIds: row.place_ids,
          updatedAt: row.updated_at.toISOString(),
        }
        return row.kind === 'entry'
          ? { kind: 'entry' as const, title: row.title!, ...common }
          : { kind: 'note' as const, title: null, ...common }
      }),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeWritingCursor(input.kind, {
          updatedAt: last.updated_at.toISOString(),
          documentId: last.id,
        }),
      } : {}),
    }
  }

  async get(input: Parameters<WritingQueries['get']>[0]) {
    const result = await this.pool.query<WritingRow>(
      `
        SELECT
          document.id,
          document.kind,
          document.title,
          document.body,
          document.visibility,
          document.publication_id,
          document.version,
          document.created_at,
          document.updated_at,
          ARRAY(
            SELECT link.canonical_place_id
            FROM writing.document_place_links AS link
            WHERE link.document_id = document.id
            ORDER BY link.position
          ) AS place_ids
        FROM writing.documents AS document
        WHERE document.id = $1::uuid AND document.owner_membership_id = $2::uuid
      `,
      [input.documentId, input.memberId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      schemaVersion: 'writing-detail.v1' as const,
      document: document(row),
    }
  }
}
