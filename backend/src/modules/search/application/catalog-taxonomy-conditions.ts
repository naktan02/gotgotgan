import type { CatalogSearchInterpretation, CatalogTaxonomyVocabularyNode } from '../domain/catalog-home-search.js'

/** A descendant already implies its category ancestors. Attributes remain independent. */
export function narrowTaxonomyConditions(
  interpretation: CatalogSearchInterpretation,
  nodes: readonly CatalogTaxonomyVocabularyNode[],
): CatalogSearchInterpretation {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const redundant = new Set<string>()
  for (const reference of interpretation.taxonomyReferences) {
    if (byKey.get(reference.key)?.kind !== 'category') continue
    let parentKey = byKey.get(reference.key)?.parentKey
    const seen = new Set([reference.key])
    while (parentKey != null && !seen.has(parentKey)) {
      seen.add(parentKey)
      if (byKey.get(parentKey)?.kind === 'category') redundant.add(parentKey)
      parentKey = byKey.get(parentKey)?.parentKey
    }
  }
  return {
    ...interpretation,
    tokens: interpretation.tokens.filter((token) => token.kind !== 'place-type' || !redundant.has(token.key)),
    taxonomyReferences: interpretation.taxonomyReferences.filter(({ key }) => !redundant.has(key)),
  }
}
