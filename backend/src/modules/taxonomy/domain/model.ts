export type TaxonomyNodeVersion = Readonly<{
  key: string
  parentKey: string | null
  label: string
  kind: 'category' | 'attribute'
  version: number
  active: boolean
  effectiveAt: string
}>

export class InvalidTaxonomyNodeError extends Error {
  override readonly name = 'InvalidTaxonomyNodeError'
}

export class TaxonomyVersionConflictError extends Error {
  override readonly name = 'TaxonomyVersionConflictError'
}

export function assertTaxonomyNode(node: TaxonomyNodeVersion): void {
  if (
    node.key.trim().length === 0 || node.key.length > 128 ||
    node.parentKey === node.key || (node.parentKey !== null && node.parentKey.length > 128) ||
    node.label.trim().length === 0 || node.label.length > 160 ||
    !Number.isInteger(node.version) || node.version < 1 ||
    !Number.isFinite(Date.parse(node.effectiveAt))
  ) throw new InvalidTaxonomyNodeError('Taxonomy node is invalid.')
}
