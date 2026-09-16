import type { Pool, PoolClient } from 'pg'

import type { TaxonomyStore } from '../../application/ports/taxonomy-store.js'
import type { TaxonomyNodeVersion } from '../../domain/model.js'
import { InvalidTaxonomyNodeError } from '../../domain/model.js'

type TaxonomyRow = Readonly<{
  node_key: string
  parent_key: string | null
  label: string
  kind: TaxonomyNodeVersion['kind']
  version: number
  active: boolean
  effective_at: Date
}>

function sameNode(row: TaxonomyRow, node: TaxonomyNodeVersion): boolean {
  return row.parent_key === node.parentKey && row.label === node.label &&
    row.kind === node.kind && row.active === node.active &&
    row.effective_at.toISOString() === node.effectiveAt
}

async function publishWithClient(client: PoolClient, node: TaxonomyNodeVersion) {
  const inserted = await client.query(
    `
      INSERT INTO taxonomy.node_versions (
        node_key, version, parent_key, label, kind, active, effective_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      ON CONFLICT (node_key, version) DO NOTHING
      RETURNING node_key
    `,
    [node.key, node.version, node.parentKey, node.label, node.kind, node.active, node.effectiveAt],
  )
  if (inserted.rowCount === 1) return 'published' as const
  const existing = await client.query<TaxonomyRow>(
    `
      SELECT node_key, parent_key, label, kind, version, active, effective_at
      FROM taxonomy.node_versions
      WHERE node_key = $1 AND version = $2
    `,
    [node.key, node.version],
  )
  return existing.rows[0] !== undefined && sameNode(existing.rows[0], node)
    ? 'replayed' as const
    : 'conflict' as const
}

export class PostgresTaxonomyStore implements TaxonomyStore {
  constructor(private readonly pool: Pool) {}

  async readVersions(references: readonly Readonly<{ key: string; version: number }>[]): Promise<readonly TaxonomyNodeVersion[]> {
    if (references.length > 256 || references.some(({ key, version }) =>
      key.trim().length === 0 || key.length > 128 || !Number.isInteger(version) || version < 1 || version > 2_147_483_647)) {
      throw new InvalidTaxonomyNodeError('Taxonomy version references are invalid.')
    }
    if (references.length === 0) return []
    const unique = [...new Map(references.map((reference) => [`${reference.key}\u0000${reference.version}`, reference])).values()]
    const result = await this.pool.query<TaxonomyRow>(`
      SELECT nodes.node_key, nodes.parent_key, nodes.label, nodes.kind,
             nodes.version, nodes.active, nodes.effective_at
      FROM taxonomy.node_versions nodes
      JOIN unnest($1::text[], $2::integer[]) AS requested(node_key, version)
        ON nodes.node_key = requested.node_key AND nodes.version = requested.version
      ORDER BY nodes.node_key, nodes.version
    `, [unique.map(({ key }) => key), unique.map(({ version }) => version)])
    return result.rows.map((row) => ({
      key: row.node_key, parentKey: row.parent_key, label: row.label, kind: row.kind,
      version: row.version, active: row.active, effectiveAt: row.effective_at.toISOString(),
    }))
  }

  async publish(node: TaxonomyNodeVersion) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const outcome = await publishWithClient(client, node)
      await client.query('COMMIT')
      return outcome
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async listCurrent(): Promise<readonly TaxonomyNodeVersion[]> {
    const result = await this.pool.query<TaxonomyRow>(`
      SELECT DISTINCT ON (node_key)
        node_key, parent_key, label, kind, version, active, effective_at
      FROM taxonomy.node_versions
      ORDER BY node_key, version DESC
    `)
    return result.rows.map((row) => ({
      key: row.node_key,
      parentKey: row.parent_key,
      label: row.label,
      kind: row.kind,
      version: row.version,
      active: row.active,
      effectiveAt: row.effective_at.toISOString(),
    }))
  }
}
