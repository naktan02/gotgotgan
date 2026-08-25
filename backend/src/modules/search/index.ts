export {
  InvalidSearchCursorError,
  InvalidLocalSearchProjectionError,
  type LocalPlaceSearchDocument,
  type MemberSearchSignal,
  type PlaceSearchPage,
  type PlaceSearchQuery,
  type PlaceSearchResult,
  type SearchBounds,
  type SearchFilters,
  type SearchSourceOutcome,
} from './domain/model.js'
export {
  InvalidPlaceSuggestionError,
  PlaceSuggestionReferenceUnavailableError,
  type PlaceSuggestion,
  type PlaceSuggestionCandidate,
  type PlaceSuggestionQuery,
  type PlaceSuggestionsPage,
  type StoredPlaceSuggestion,
  type SuggestionImpression,
  type SuggestionMaterializationIntent,
  type SuggestionSession,
} from './domain/suggestions.js'
export { createPlaceSearch } from './application/search-places.js'
export { createPlaceSuggestions } from './application/suggest-places.js'
export {
  createPlaceSuggestionSelection,
  type SuggestionObservationInput,
  type SuggestionObservationRecorder,
} from './application/select-place-suggestion.js'
export {
  createPlaceSuggestionMaterialization,
  type SuggestionMaterializationInput,
  type SuggestionMaterializer,
} from './application/materialize-place-suggestion.js'
export {
  projectLocalPlace,
  projectMemberSearchSignal,
} from './application/project-local-search.js'
export type { LocalSearchProjectionStore } from './application/ports/local-search-projection-store.js'
export type {
  PlaceSearchSource,
  SearchSourcePage,
} from './application/ports/place-search-source.js'
export type {
  PlaceSuggestionSource,
  SuggestionSourceBatch,
} from './application/ports/place-suggestion-source.js'
export type { PlaceSuggestionStore } from './application/ports/place-suggestion-store.js'
export { PostgresLocalSearch } from './adapters/persistence/postgres-local-search.js'
export { PostgresPlaceSuggestions } from './adapters/persistence/postgres-place-suggestions.js'
export {
  registerSearchHttpRoutes,
  type SearchHttpDependencies,
} from './transport/http/register-search-http.js'
export type { SuggestionHttpDependencies } from './transport/http/register-suggestion-http.js'
