import type {
  PlaceSuggestionCandidate,
  PlaceSuggestionQuery,
} from '../../domain/suggestions.js'

export type SuggestionSourceBatch = Readonly<{
  status: 'complete' | 'partial' | 'unavailable'
  items: readonly PlaceSuggestionCandidate[]
  errorCode?: string
}>

export interface PlaceSuggestionSource {
  readonly sourceKey: string
  suggest(query: Omit<PlaceSuggestionQuery, 'sessionId'> & Readonly<{
    sessionId: string
  }>): Promise<SuggestionSourceBatch>
}
