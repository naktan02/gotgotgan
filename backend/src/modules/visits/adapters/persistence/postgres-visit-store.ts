import type { Pool } from 'pg'

import type { VisitStore } from '../../application/ports/visit-store.js'
import type { VisitRecord, VisitSummary } from '../../domain/model.js'

export class PostgresVisitStore implements VisitStore {
  constructor(private readonly pool: Pool) {}

  async append(record: VisitRecord): Promise<'recorded' | 'conflict'> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('place.visit.v1:' || $1, 0))", [record.id])
      const prior = await client.query<{ fingerprint: string }>(
        'SELECT fingerprint FROM visits.visit_occurrences WHERE id = $1', [record.id],
      )
      if (prior.rows[0] !== undefined) {
        await client.query('COMMIT')
        return prior.rows[0].fingerprint === record.fingerprint ? 'recorded' : 'conflict'
      }
      await client.query(
        `INSERT INTO visits.visit_occurrences
          (id, membership_id, canonical_place_id, visited_at, recorded_at, evidence, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [record.id, record.memberId, record.placeId, record.visitedAt, record.recordedAt,
          record.evidence ?? null, record.fingerprint],
      )
      await client.query('COMMIT')
      return 'recorded'
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async summarize(memberId: string, placeId: string): Promise<VisitSummary> {
    const result = await this.pool.query<{
      count: string
      first_visited_at: Date | null
      last_visited_at: Date | null
    }>(
      `SELECT count(*)::text AS count, min(visited_at) AS first_visited_at,
              max(visited_at) AS last_visited_at
       FROM visits.visit_occurrences WHERE membership_id = $1 AND canonical_place_id = $2`,
      [memberId, placeId],
    )
    const row = result.rows[0]!
    const count = Number(row.count)
    return count === 0 ? { visited: false, count: 0 } : {
      visited: true,
      count,
      firstVisitedAt: row.first_visited_at!.toISOString(),
      lastVisitedAt: row.last_visited_at!.toISOString(),
    }
  }

}
