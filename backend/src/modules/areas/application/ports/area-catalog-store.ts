import type { AreaNode, AreaNodeVersion } from '../../domain/model.js'

export type PublishAreaNodeOutcome =
  | 'published'
  | 'replayed'
  | 'conflict'
  | 'parent-unavailable'
  | 'cycle'

export interface AreaCatalogStore {
  publish(node: AreaNodeVersion): Promise<PublishAreaNodeOutcome>
  listCurrent(): Promise<readonly AreaNode[]>
  readCurrentPath(areaKey: string): Promise<readonly AreaNode[] | undefined>
}
