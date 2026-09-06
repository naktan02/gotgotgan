import type { createCatalogExploration } from '../../application/explore-catalog.js'
import type { CatalogPlaceSearchInput, CatalogPlaceSearchPage } from '../../domain/catalog-home-search.js'
import type { CatalogPlaceMapInput, CatalogPlaceMapResponse } from '../../domain/catalog-map.js'
import type { PlaceSearchPage, PlaceSearchQuery } from '../../domain/model.js'
import type { ProductAuthorizer } from '../../../../platform/http/product-authorization.js'
import type { SuggestionHttpDependencies } from './register-suggestion-http.js'

export type SearchHttpDependencies = Readonly<{
  explore?: ReturnType<typeof createCatalogExploration>
  search: (query: PlaceSearchQuery) => Promise<PlaceSearchPage>
  catalog?: (query: CatalogPlaceSearchInput) => Promise<CatalogPlaceSearchPage>
  catalogMap?: (query: CatalogPlaceMapInput) => Promise<CatalogPlaceMapResponse>
  authorizer?: ProductAuthorizer
  suggestions?: SuggestionHttpDependencies
}>
