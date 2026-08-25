import type { TaxonomyNodeVersion } from '../../domain/model.js'

export interface TaxonomyStore {
  publish(node: TaxonomyNodeVersion): Promise<'published' | 'replayed' | 'conflict'>
  listCurrent(): Promise<readonly TaxonomyNodeVersion[]>
}
