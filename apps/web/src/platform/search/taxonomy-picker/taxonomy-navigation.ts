import type { TaxonomyNode } from '@place/contracts/search'

export function taxonomyTrail(nodes: readonly TaxonomyNode[], key: string | null): readonly TaxonomyNode[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const trail: TaxonomyNode[] = []
  const seen = new Set<string>()
  while (key !== null && !seen.has(key)) {
    seen.add(key)
    const node = byKey.get(key)
    if (!node) break
    trail.unshift(node)
    key = node.parentKey
  }
  return trail
}

export function taxonomyCandidates(nodes: readonly TaxonomyNode[], parentKey: string | null, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const withinScope = (node: TaxonomyNode) => {
    if (parentKey === null) return true
    let current: TaxonomyNode | undefined = node
    const seen = new Set<string>()
    while (current && !seen.has(current.key)) {
      if (current.key === parentKey) return true
      seen.add(current.key)
      current = current.parentKey === null ? undefined : byKey.get(current.parentKey)
    }
    return false
  }
  return nodes.filter((node) => normalized
    ? node.label.toLocaleLowerCase().includes(normalized) && withinScope(node)
    : node.parentKey === parentKey)
}
