export {
  listCurrentAreas,
  publishAreaNode,
  readAreaPath,
} from './application/area-catalog.js'
export type {
  AreaCatalogStore,
  PublishAreaNodeOutcome,
} from './application/ports/area-catalog-store.js'
export {
  AreaHierarchyCycleError,
  AreaParentUnavailableError,
  AreaVersionConflictError,
  InvalidAreaNodeError,
  areaKinds,
  assertAreaNodeVersion,
} from './domain/model.js'
export type {
  AreaKind,
  AreaName,
  AreaNode,
  AreaNodeVersion,
} from './domain/model.js'
export { PostgresAreaCatalog } from './adapters/persistence/postgres-area-catalog.js'
export { searchGeographicCatalog, searchLegacyGeographicCatalog } from './adapters/geographic-catalog/search-geographic-catalog.js'
export type { GeographicDestination } from './domain/geographic-destination.js'
