import type { Pool } from 'pg'

import type { VisitQueries } from '../../application/visit-queries.js'
import { decodeVisitCursor, encodeVisitCursor } from '../../application/visit-cursor.js'
import { InvalidVisitQueryError } from '../../domain/queries.js'

type VisitRow = Readonly<{
  id: string
  visited_at: Date
  recorded_at: Date
}>

function requireBoundedLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidVisitQueryError('Visit query limit must be between 1 and 50.')
  }
}

export class PostgresVisitQueries implements VisitQueries {
  constructor(private readonly pool: Pool) {}

  async listPlaceVisits(input: Parameters<VisitQueries['listPlaceVisits']>[0]) {
    requireBoundedLimit(input.limit)
    const cursor = decodeVisitCursor(input.cursor, input.placeId)
    const result = await this.pool.query<VisitRow>(
      `
        SELECT id, visited_at, recorded_at
        FROM visits.visit_occurrences
        WHERE membership_id = $1::uuid
          AND canonical_place_id = $2::uuid
          AND (
            $3::timestamptz IS NULL
            OR visited_at < $3::timestamptz
            OR (visited_at = $3::timestamptz AND id > $4::uuid)
          )
        ORDER BY visited_at DESC, id ASC
        LIMIT $5
      `,
      [input.memberId, input.placeId, cursor?.visitedAt ?? null,
        cursor?.visitId ?? null, input.limit + 1],
    )
    const hasMore = result.rows.length > input.limit
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows
    const last = rows.at(-1)
    return {
      schemaVersion: 'visit-history.v1' as const,
      placeId: input.placeId,
      items: rows.map((row) => ({
        visitId: row.id,
        visitedAt: row.visited_at.toISOString(),
        recordedAt: row.recorded_at.toISOString(),
      })),
      ...(hasMore && last !== undefined ? {
        nextCursor: encodeVisitCursor(input.placeId, {
          visitedAt: last.visited_at.toISOString(),
          visitId: last.id,
        }),
      } : {}),
    }
  }
}
