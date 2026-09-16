import { productTaxonomyNodes } from './product-taxonomy.js'

/** Exact product vocabulary only; callers must establish that input is a place classification. */
export function matchProductTaxonomyLabel(label: string): Readonly<{ key: string; label: string }> | undefined {
  const normalized = label.normalize('NFKC').trim()
  const matches = productTaxonomyNodes.filter((node) => node.label === normalized)
  if (matches.length !== 1) return undefined
  const { key, label: matchedLabel } = matches[0]!
  return { key, label: matchedLabel }
}
