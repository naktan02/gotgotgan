import type {
  CatalogPlaceMapProjection,
  CatalogPlaceMapQuery,
} from '../../domain/catalog-map.js'

export interface CatalogPlaceMapSource {
  projectCatalogMap(query: CatalogPlaceMapQuery): Promise<CatalogPlaceMapProjection>
}
