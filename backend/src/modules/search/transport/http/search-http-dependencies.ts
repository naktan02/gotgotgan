import type { createCatalogExploration, createCatalogExplorationV2 } from '../../application/explore-catalog.js'
import type { CatalogPlaceSearchInput, CatalogPlaceSearchPage } from '../../domain/catalog-home-search.js'
import type { CatalogPlaceMapInput, CatalogPlaceMapResponse } from '../../domain/catalog-map.js'
import type { PlaceSearchPage, PlaceSearchQuery } from '../../domain/model.js'
import type { ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import type { SuggestionHttpDependencies } from './register-suggestion-http.js'
import type { CatalogPlaceMapInputV3, CatalogPlaceMapResponseV3 } from '../../application/search-catalog-map-v3.js'

export type SearchHttpDependencies = Readonly<{
  explore?: ReturnType<typeof createCatalogExploration>
  exploreV2?: ReturnType<typeof createCatalogExplorationV2>
  search: (query: PlaceSearchQuery) => Promise<PlaceSearchPage>
  catalog?: (query: CatalogPlaceSearchInput) => Promise<CatalogPlaceSearchPage>
  catalogMap?: (query: CatalogPlaceMapInput) => Promise<CatalogPlaceMapResponse>
  catalogMapV3?: (query: CatalogPlaceMapInputV3) => Promise<CatalogPlaceMapResponseV3>
  authorizer?: ProductAuthorizer
  suggestions?: SuggestionHttpDependencies
}>
