import type {
  StoredPlaceSuggestion,
  SuggestionImpression,
  SuggestionSession,
} from '../../domain/suggestions.js'

export interface PlaceSuggestionStore {
  openSession(input: Readonly<{
    requestedSessionId?: string
    newSession: SuggestionSession
    now: string
  }>): Promise<SuggestionSession>
  recordImpressions(input: Readonly<{
    sessionId: string
    impressions: readonly SuggestionImpression[]
  }>): Promise<readonly StoredPlaceSuggestion[]>
  select(suggestionId: string, selectedAt: string): Promise<Readonly<{
    status: 'recorded' | 'replayed'
    suggestion: StoredPlaceSuggestion
  }> | undefined>
  markMaterialized(suggestionId: string, materializedAt: string): Promise<'recorded' | 'replayed'>
  cleanupExpired(now: string, limit: number): Promise<Readonly<{
    sessions: number
    suggestions: number
    discoveries: number
  }>>
}
