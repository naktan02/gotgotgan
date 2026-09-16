import type { AreaCatalogStore } from './ports/area-catalog-store.js'
import {
  AreaHierarchyCycleError,
  AreaParentUnavailableError,
  AreaVersionConflictError,
  assertAreaNodeVersion,
  type AreaNodeVersion,
} from '../domain/model.js'

export async function publishAreaNode(
  node: AreaNodeVersion,
  store: AreaCatalogStore,
): Promise<'published' | 'replayed'> {
  assertAreaNodeVersion(node)
  const outcome = await store.publish(node)
  if (outcome === 'conflict') throw new AreaVersionConflictError('Area version conflicts.')
  if (outcome === 'parent-unavailable') {
    throw new AreaParentUnavailableError('The parent Area is unavailable.')
  }
  if (outcome === 'cycle') throw new AreaHierarchyCycleError('Area hierarchy would contain a cycle.')
  return outcome
}

export async function listCurrentAreas(store: AreaCatalogStore) {
  return {
    schemaVersion: 'place-areas.v1' as const,
    nodes: await store.listCurrent(),
  }
}

export async function readAreaPath(areaKey: string, store: AreaCatalogStore) {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/.test(areaKey)) {
    throw new AreaParentUnavailableError('The Area is unavailable.')
  }
  return store.readCurrentPath(areaKey)
}
