import type { TaxonomyStore } from './ports/taxonomy-store.js'
import {
  TaxonomyVersionConflictError,
  assertTaxonomyNode,
  type TaxonomyNodeVersion,
} from '../domain/model.js'

export async function publishTaxonomyNode(
  node: TaxonomyNodeVersion,
  store: TaxonomyStore,
): Promise<'published' | 'replayed'> {
  assertTaxonomyNode(node)
  const outcome = await store.publish(node)
  if (outcome === 'conflict') {
    throw new TaxonomyVersionConflictError('Taxonomy node version conflicts with prior meaning.')
  }
  return outcome
}

export async function listCurrentTaxonomy(store: TaxonomyStore) {
  const nodes = (await store.listCurrent())
    .filter((node) => node.active)
    .map(({ active: _, effectiveAt: __, ...node }) => node)
  return { schemaVersion: 'place-taxonomy.v1' as const, nodes }
}
