import type { Client, PoolClient } from 'pg'

import { TaxonomyVersionConflictError } from '../../domain/model.js'
import { productTaxonomyNodes } from '../product-catalog/product-taxonomy.js'

/** Explicit owner provisioning only. Never invoked by HTTP/worker startup. */
export async function seedProductTaxonomy(client: Pick<Client | PoolClient, 'query'>) {
  await client.query('BEGIN')
  try {
    await client.query('LOCK TABLE taxonomy.node_versions IN SHARE ROW EXCLUSIVE MODE')
    const current = await client.query<{
      node_key: string; parent_key: string | null; label: string; kind: string; active: boolean
    }>(`SELECT DISTINCT ON (node_key) node_key, parent_key, label, kind, active
        FROM taxonomy.node_versions WHERE node_key = ANY($1::text[])
        ORDER BY node_key, version DESC`, [productTaxonomyNodes.map((node) => node.key)])
    const byKey = new Map(current.rows.map((row) => [row.node_key, row]))
    let published = 0
    for (const node of productTaxonomyNodes) {
      const existing = byKey.get(node.key)
      if (existing) {
        if (existing.parent_key !== node.parentKey || existing.label !== node.label ||
            existing.kind !== node.kind || existing.active !== node.active) {
          throw new TaxonomyVersionConflictError('Product taxonomy conflicts with existing vocabulary.')
        }
        continue
      }
      await client.query(`INSERT INTO taxonomy.node_versions
        (node_key, version, parent_key, label, kind, active, effective_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [node.key, node.version, node.parentKey, node.label, node.kind, node.active, node.effectiveAt])
      published += 1
    }
    await client.query('COMMIT')
    return { published, replayed: productTaxonomyNodes.length - published }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
