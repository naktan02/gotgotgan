import type { Pool, PoolClient } from 'pg'

import type {
  AreaCatalogStore,
  PublishAreaNodeOutcome,
} from '../../application/ports/area-catalog-store.js'
import type { AreaName, AreaNode, AreaNodeVersion } from '../../domain/model.js'

type AreaRow = Readonly<{
  area_key: string
  version: number
  parent_area_key: string | null
  country_code: string
  kind: AreaNodeVersion['kind']
  localized_names: unknown
  default_language_tag: string
  active: boolean
  effective_at: Date | string
  fingerprint: string
}>

function names(value: unknown): readonly AreaName[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored Area names are invalid.')
  }
  return Object.entries(value).map(([languageTag, name]) => {
    if (typeof name !== 'string') throw new Error('Stored Area names are invalid.')
    return { languageTag, name }
  })
}

function namesJson(value: readonly AreaName[]): Readonly<Record<string, string>> {
  return Object.fromEntries(value.map(({ languageTag, name }) => [languageTag, name]))
}

function node(row: AreaRow): AreaNode {
  return {
    key: row.area_key,
    version: Number(row.version),
    parentKey: row.parent_area_key,
    countryCode: row.country_code,
    kind: row.kind,
    names: names(row.localized_names),
    defaultLanguageTag: row.default_language_tag,
  }
}

async function existingOutcome(
  client: PoolClient,
  candidate: AreaNodeVersion,
): Promise<'replayed' | 'conflict'> {
  const existing = await client.query<Pick<AreaRow, 'fingerprint'>>(
    `SELECT fingerprint FROM areas.area_node_versions
     WHERE area_key = $1 AND version = $2`,
    [candidate.key, candidate.version],
  )
  return existing.rows[0]?.fingerprint === candidate.fingerprint ? 'replayed' : 'conflict'
}

export class PostgresAreaCatalog implements AreaCatalogStore {
  constructor(private readonly pool: Pool) {}

  async publish(candidate: AreaNodeVersion): Promise<PublishAreaNodeOutcome> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('place.area.v1:' || $1, 0))",
        [candidate.key],
      )
      const replay = await client.query(
        `SELECT 1 FROM areas.area_node_versions WHERE area_key = $1 AND version = $2`,
        [candidate.key, candidate.version],
      )
      if (replay.rows[0] !== undefined) {
        const outcome = await existingOutcome(client, candidate)
        await client.query('COMMIT')
        return outcome
      }

      const latest = await client.query<Readonly<{ version: number }>>(
        `SELECT version FROM areas.area_node_versions
         WHERE area_key = $1 ORDER BY version DESC LIMIT 1`,
        [candidate.key],
      )
      const expectedVersion = latest.rows[0] === undefined
        ? 1
        : Number(latest.rows[0].version) + 1
      if (candidate.version !== expectedVersion) {
        await client.query('ROLLBACK')
        return 'conflict'
      }

      if (candidate.parentKey !== null) {
        const parent = await client.query<Readonly<{ country_code: string; active: boolean }>>(
          `SELECT country_code, active
           FROM areas.area_node_versions
           WHERE area_key = $1
           ORDER BY version DESC
           LIMIT 1`,
          [candidate.parentKey],
        )
        if (
          parent.rows[0] === undefined ||
          !parent.rows[0].active ||
          parent.rows[0].country_code !== candidate.countryCode
        ) {
          await client.query('ROLLBACK')
          return 'parent-unavailable'
        }
        const cycle = await client.query(
          `WITH RECURSIVE current_nodes AS (
             SELECT DISTINCT ON (area_key) area_key, parent_area_key
             FROM areas.area_node_versions
             ORDER BY area_key, version DESC
           ), ancestors AS (
             SELECT area_key, parent_area_key FROM current_nodes WHERE area_key = $1
             UNION ALL
             SELECT parent.area_key, parent.parent_area_key
             FROM current_nodes AS parent
             JOIN ancestors AS child ON child.parent_area_key = parent.area_key
           )
           SELECT 1 FROM ancestors WHERE area_key = $2 LIMIT 1`,
          [candidate.parentKey, candidate.key],
        )
        if (cycle.rows[0] !== undefined) {
          await client.query('ROLLBACK')
          return 'cycle'
        }
      }

      await client.query(
        `INSERT INTO areas.area_identities (area_key, created_at)
         VALUES ($1, $2::timestamptz)
         ON CONFLICT (area_key) DO NOTHING`,
        [candidate.key, candidate.effectiveAt],
      )
      await client.query(
        `INSERT INTO areas.area_node_versions (
           area_key, version, previous_version, parent_area_key, country_code, kind,
           localized_names, default_language_tag, active, effective_at, fingerprint
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::timestamptz,$11)`,
        [candidate.key, candidate.version, candidate.version === 1 ? null : candidate.version - 1,
          candidate.parentKey, candidate.countryCode,
          candidate.kind, JSON.stringify(namesJson(candidate.names)), candidate.defaultLanguageTag,
          candidate.active, candidate.effectiveAt, candidate.fingerprint],
      )
      await client.query('COMMIT')
      return 'published'
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async listCurrent(): Promise<readonly AreaNode[]> {
    const result = await this.pool.query<AreaRow>(`
      SELECT DISTINCT ON (area_key)
        area_key, version, parent_area_key, country_code, kind, localized_names,
        default_language_tag, active, effective_at, fingerprint
      FROM areas.area_node_versions
      ORDER BY area_key, version DESC
    `)
    return result.rows.filter((row) => row.active).map(node)
  }

  async readCurrentPath(areaKey: string): Promise<readonly AreaNode[] | undefined> {
    const result = await this.pool.query<AreaRow>(
      `WITH RECURSIVE current_nodes AS (
         SELECT DISTINCT ON (area_key)
           area_key, version, parent_area_key, country_code, kind, localized_names,
           default_language_tag, active, effective_at, fingerprint
         FROM areas.area_node_versions
         ORDER BY area_key, version DESC
       ), path AS (
         SELECT current_nodes.*, 0 AS depth
         FROM current_nodes WHERE area_key = $1 AND active
         UNION ALL
         SELECT parent.*, child.depth + 1
         FROM current_nodes AS parent
         JOIN path AS child ON child.parent_area_key = parent.area_key
         WHERE parent.active AND child.depth < 31
       )
       SELECT area_key, version, parent_area_key, country_code, kind, localized_names,
              default_language_tag, active, effective_at, fingerprint
       FROM path ORDER BY depth DESC`,
      [areaKey],
    )
    return result.rows.length === 0 ? undefined : result.rows.map(node)
  }
}
