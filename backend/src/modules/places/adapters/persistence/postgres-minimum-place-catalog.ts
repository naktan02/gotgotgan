import type { Pool } from 'pg'
import type { MinimumPlacePublication } from '../../domain/minimum-place-facts.js'
import { readCurrentMinimumPlaces } from './minimum-catalog/current-profile.js'
import { publishMinimumProfile } from './minimum-catalog/publish-minimum.js'

/** The minimum-facts import seam reuses canonical assertions/profile history, not a second master. */
export class PostgresMinimumPlaceCatalog {
  constructor(private readonly pool: Pool) {}

  async publish(input: MinimumPlacePublication) {
    if (input.facts.schemaVersion !== 'minimum-place-facts.v1' ||
      input.facts.name.trim().length === 0 || input.facts.name.length > 300 ||
      (input.facts.address !== null && (input.facts.address.trim().length === 0 || input.facts.address.length > 500)) ||
      !['provider-listed-facts', 'member-approved-legacy-facts'].includes(input.publicationBasis) ||
      !Number.isFinite(Date.parse(input.observedAt)) || !Number.isFinite(Date.parse(input.recordedAt)) ||
      Date.parse(input.recordedAt) < Date.parse(input.observedAt)) throw new Error('Invalid minimum facts')
    const location = input.facts.location
    if (location !== null && (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180)) throw new Error('Invalid minimum location')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const status = await publishMinimumProfile(client, input)
      const current = (await readCurrentMinimumPlaces(client, [input.placeId]))[0]!
      await client.query('COMMIT')
      return { status, current }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { client.release() }
  }

  read(placeIds: readonly string[]) { return readCurrentMinimumPlaces(this.pool, placeIds) }

  /** Existing append-only change feed is the recovery source for a failed search projection. */
  async changes(afterSequence: string, limit = 250) {
    if (!/^(0|[1-9][0-9]*)$/.test(afterSequence) || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Invalid catalog change page')
    }
    return (await this.pool.query<{ sequence: string; canonical_place_id: string }>(
      `SELECT sequence::text, canonical_place_id FROM places.canonical_place_catalog_changes
       WHERE sequence > $1::bigint ORDER BY sequence LIMIT $2`, [afterSequence, limit],
    )).rows.map((row) => ({ sequence: row.sequence, placeId: row.canonical_place_id }))
  }
}
