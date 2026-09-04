import { anonymous, bearer, browserSession, described, operation, optionalBearer, ref } from '../model.js'

export const searchPaths = {
  '/api/search/places': { post: operation('searchPlacesForBrowser', {
    '200': described('Return validated provider-neutral search results', 'PlaceSearchResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSearchRequest' }) },
  '/api/search/catalog': { post: operation('searchCanonicalPlaceCatalogForBrowser', {
    '200': described(
      'Return interpreted canonical-only catalog results and their map bounds',
      'CatalogPlaceSearchResponse',
    ),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'CatalogPlaceSearchRequest' }) },
  '/api/search/catalog/map': { post: operation('projectCanonicalPlaceCatalogMapForBrowser', {
    '200': described(
      'Return exact viewport coverage as bounded canonical places or server-side clusters',
      'CatalogPlaceMapResponse',
    ),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'CatalogPlaceMapRequest' }) },
  '/api/search/suggestions': { post: operation('suggestPlacesForBrowser', {
    '200': described('Return provider-neutral query-as-you-type candidates', 'PlaceSuggestionsResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionsRequest' }) },
  '/api/search/suggestion-selections': { post: operation('selectPlaceSuggestionForBrowser', {
    '200': described('Record an idempotent explicit suggestion selection', 'PlaceSuggestionSelectionResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionSelectionRequest' }) },
  '/api/search/taxonomy': { get: operation('listPlaceTaxonomyNodesForBrowser', {
    '200': described('Return the current provider-neutral taxonomy', 'TaxonomyProjection'),
    '503': ref('responses', 'BrowserBackendUnavailable'),
  }, { security: anonymous }) },
  '/v1/search/places': { post: operation('searchPlaces', {
    '200': described('Return provider-neutral local projection results', 'PlaceSearchResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: optionalBearer, requestSchema: 'PlaceSearchRequest' }) },
  '/v1/search/catalog': { post: operation('searchCanonicalPlaceCatalog', {
    '200': described(
      'Return interpreted canonical-only catalog results and their map bounds',
      'CatalogPlaceSearchResponse',
    ),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'CatalogPlaceSearchRequest' }) },
  '/v1/search/catalog/map': { post: operation('projectCanonicalPlaceCatalogMap', {
    '200': described(
      'Return exact viewport coverage as bounded canonical places or server-side clusters',
      'CatalogPlaceMapResponse',
    ),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'CatalogPlaceMapRequest' }) },
  '/v1/search/suggestions': { post: operation('suggestPlaces', {
    '200': described('Return bounded local projection suggestions', 'PlaceSuggestionsResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionsRequest' }) },
  '/v1/search/suggestion-selections': { post: operation('selectPlaceSuggestion', {
    '200': described('Record explicit selection evidence exactly once', 'PlaceSuggestionSelectionResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'PlaceSuggestionSelectionRequest' }) },
  '/v1/search/suggestion-materializations': { post: operation('materializePlaceSuggestion', {
    '200': described('Create or link a Canonical Place through evidence and resolution', 'PlaceSuggestionMaterializationResponse'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '401': ref('responses', 'AuthenticationRequired'),
    '403': ref('responses', 'AccessDenied'),
    '404': ref('responses', 'ProductNotFound'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: bearer, requestSchema: 'PlaceSuggestionMaterializationRequest' }) },
  '/v1/providers/place-details': { post: operation('getProviderPlaceDetailsForOperatorComposition', {
    '200': described('Return a bounded provider detail projection for a non-interactive operator composition', 'ProviderPlaceDetail'),
    '400': ref('responses', 'ProductRequestInvalid'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous, requestSchema: 'ProviderPlaceDetailRequest' }) },
  '/v1/taxonomy/nodes': { get: operation('listPlaceTaxonomyNodes', {
    '200': described('Return the current provider-neutral taxonomy', 'TaxonomyProjection'),
    '503': ref('responses', 'ProductUnavailable'),
  }, { security: anonymous }) },
}
