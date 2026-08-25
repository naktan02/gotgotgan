import type { SearchBounds, SearchSourceOutcome } from './model.js'

export type PlaceSuggestionQuery = Readonly<{
  query: string
  sessionId?: string
  bounds?: SearchBounds
  areaText?: string
  language?: string
  limit: number
}>

export type PlaceSuggestionCandidate = Readonly<{
  candidateKey: string
  identity:
    | Readonly<{ kind: 'canonical'; placeId: string }>
    | Readonly<{
      kind: 'provider'
      providerKey: 'naver' | 'kakao' | 'google'
      providerPlaceId?: string
    }>
  source: Readonly<{
    key: string
    label: string
    externalUri?: string
    detailsAvailable: boolean
    attributions: readonly Readonly<{ label: string; uri?: string }>[]
  }>
  name: string
  areaLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  categoryLabel: string | null
  observedAt: string
}>

export type PlaceSuggestion = Omit<PlaceSuggestionCandidate, 'candidateKey'> & Readonly<{
  suggestionId: string
}>

export type PlaceSuggestionsPage = Readonly<{
  schemaVersion: 'place-suggestions.v1'
  sessionId: string
  items: readonly PlaceSuggestion[]
  sources: readonly SearchSourceOutcome[]
}>

export type SuggestionSession = Readonly<{
  id: string
  createdAt: string
  expiresAt: string
}>

export type SuggestionImpression = Readonly<{
  suggestionId: string
  candidate: PlaceSuggestionCandidate
  createdAt: string
  expiresAt: string
  observationId?: string
  candidateId?: string
  decisionId?: string
  proposedPlaceId?: string
}>

export type StoredPlaceSuggestion = SuggestionImpression & Readonly<{
  sessionId: string
  selectedAt?: string
  materializedAt?: string
}>

export type SuggestionMaterializationIntent =
  | 'save'
  | 'wanted'
  | 'visit'
  | 'rating'
  | 'note'
  | 'collection'
  | 'share'
  | 'place-reference'

export class InvalidPlaceSuggestionError extends Error {
  override readonly name = 'InvalidPlaceSuggestionError'
}

export class PlaceSuggestionReferenceUnavailableError extends Error {
  override readonly name = 'PlaceSuggestionReferenceUnavailableError'
}

export function assertSuggestionCandidate(candidate: PlaceSuggestionCandidate): void {
  const location = candidate.location
  if (
    candidate.candidateKey.length === 0 || candidate.candidateKey.length > 512 ||
    candidate.name.trim().length === 0 || candidate.name.length > 300 ||
    !Number.isFinite(Date.parse(candidate.observedAt)) ||
    (location !== null && (
      location.latitude < -90 || location.latitude > 90 ||
      location.longitude < -180 || location.longitude > 180
    ))
  ) throw new InvalidPlaceSuggestionError('Place suggestion candidate is invalid.')
}
