import type {
  CatalogPlaceSearchQuery,
  CatalogPlaceSummary,
} from '../../domain/catalog-home-search.js'

export type CatalogPlaceSearchSourcePage = Readonly<{
  items: readonly CatalogPlaceSummary[]
  nextCursor?: string
}>

export interface CatalogPlaceSearchSource {
  searchCatalog(query: CatalogPlaceSearchQuery): Promise<CatalogPlaceSearchSourcePage>
}
