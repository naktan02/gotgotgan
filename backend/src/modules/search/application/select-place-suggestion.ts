import type { PlaceSuggestionStore } from './ports/place-suggestion-store.js'
import { PlaceSuggestionReferenceUnavailableError } from '../domain/suggestions.js'

export type SuggestionObservationInput = Readonly<{
  observationId: string
  providerKey: 'naver' | 'kakao' | 'google'
  externalPlaceId: string
  providerPlaceId?: string
  name: string
  areaLabel: string | null
  categoryLabel: string | null
  location: Readonly<{ latitude: number; longitude: number }> | null
  sourceKey: string
  observedAt: string
  acquiredAt: string
}>

export type SuggestionObservationRecorder = (
  input: SuggestionObservationInput,
) => Promise<'recorded' | 'replayed'>

export function createPlaceSuggestionSelection(dependencies: Readonly<{
  store: PlaceSuggestionStore
  recordObservation: SuggestionObservationRecorder
  now?: () => Date
}>) {
  const now = dependencies.now ?? (() => new Date())
  return async (suggestionId: string) => {
    const selectedAt = now().toISOString()
    const selected = await dependencies.store.select(suggestionId, selectedAt)
    if (selected === undefined) {
      throw new PlaceSuggestionReferenceUnavailableError('Place suggestion is unavailable.')
    }
    const candidate = selected.suggestion.candidate
    if (candidate.identity.kind === 'canonical') {
      return {
        schemaVersion: 'place-suggestion-selection.v1' as const,
        suggestionId,
        status: 'canonical' as const,
      }
    }
    const observationId = selected.suggestion.observationId
    if (observationId === undefined) {
      throw new PlaceSuggestionReferenceUnavailableError('Place suggestion evidence is unavailable.')
    }
    const recorded = await dependencies.recordObservation({
      observationId,
      providerKey: candidate.identity.providerKey,
      externalPlaceId: candidate.identity.providerPlaceId ?? candidate.candidateKey,
      ...(candidate.identity.providerPlaceId === undefined
        ? {}
        : { providerPlaceId: candidate.identity.providerPlaceId }),
      name: candidate.name,
      areaLabel: candidate.areaLabel,
      categoryLabel: candidate.categoryLabel,
      location: candidate.location,
      sourceKey: candidate.source.key,
      observedAt: candidate.observedAt,
      acquiredAt: selected.suggestion.selectedAt ?? selectedAt,
    })
    return {
      schemaVersion: 'place-suggestion-selection.v1' as const,
      suggestionId,
      status: selected.status === 'replayed' || recorded === 'replayed'
        ? 'replayed' as const
        : 'recorded' as const,
      observationId,
    }
  }
}
