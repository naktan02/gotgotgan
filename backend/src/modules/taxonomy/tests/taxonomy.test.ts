import { describe, expect, it } from 'vitest'

import {
  TaxonomyVersionConflictError,
  listCurrentTaxonomy,
  publishTaxonomyNode,
  type TaxonomyStore,
} from '../index.js'

const node = {
  key: 'food.noodle.ramen',
  parentKey: 'food.noodle',
  label: '라멘',
  kind: 'category' as const,
  version: 2,
  active: true,
  effectiveAt: '2026-08-26T00:00:00.000Z',
}

describe('Taxonomy interface', () => {
  it('publishes data-defined nodes and lists only the current active projection', async () => {
    const store: TaxonomyStore = {
      publish: async () => 'published',
      listCurrent: async () => [node],
    }
    await expect(publishTaxonomyNode(node, store)).resolves.toBe('published')
    await expect(listCurrentTaxonomy(store)).resolves.toEqual({
      schemaVersion: 'place-taxonomy.v1',
      nodes: [{
        key: node.key,
        parentKey: node.parentKey,
        label: node.label,
        kind: node.kind,
        version: node.version,
      }],
    })
  })

  it('rejects reuse of a node version with different meaning', async () => {
    const store: TaxonomyStore = {
      publish: async () => 'conflict',
      listCurrent: async () => [],
    }
    await expect(publishTaxonomyNode(node, store)).rejects.toBeInstanceOf(
      TaxonomyVersionConflictError,
    )
  })
})
