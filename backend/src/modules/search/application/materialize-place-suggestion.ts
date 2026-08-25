import type { PlaceSuggestionStore } from './ports/place-suggestion-store.js'
import type {
  SuggestionMaterializationIntent,
} from '../domain/suggestions.js'
import { PlaceSuggestionReferenceUnavailableError } from '../domain/suggestions.js'

export type SuggestionMaterializationInput = Readonly<{
  intent: SuggestionMaterializationIntent
  observationId: string
  candidateId: string
  decisionId: string
  proposedPlaceId: string
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

export type SuggestionMaterializer = (
  input: SuggestionMaterializationInput,
) => Promise<Readonly<{
  status: 'created' | 'linked' | 'replayed'
  canonicalPlaceId: string
}>>

export function createPlaceSuggestionMaterialization(dependencies: Readonly<{
  store: PlaceSuggestionStore
  materialize: SuggestionMaterializer
  now?: () => Date
}>) {
  const now = dependencies.now ?? (() => new Date())
  return async (suggestionId: string, intent: SuggestionMaterializationIntent) => {
    const materializedAt = now().toISOString()
    const selected = await dependencies.store.select(suggestionId, materializedAt)
    if (selected === undefined) {
      throw new PlaceSuggestionReferenceUnavailableError('Place suggestion is unavailable.')
    }
    const candidate = selected.suggestion.candidate
    if (candidate.identity.kind === 'canonical') {
      const state = await dependencies.store.markMaterialized(suggestionId, materializedAt)
      return {
        schemaVersion: 'place-suggestion-materialization.v1' as const,
        suggestionId,
        status: state === 'replayed' ? 'replayed' as const : 'linked' as const,
        canonicalPlaceId: candidate.identity.placeId,
      }
    }
    const { observationId, candidateId, decisionId, proposedPlaceId } = selected.suggestion
    if (
      observationId === undefined || candidateId === undefined ||
      decisionId === undefined || proposedPlaceId === undefined
    ) throw new PlaceSuggestionReferenceUnavailableError('Place suggestion evidence is unavailable.')

    const result = await dependencies.materialize({
      intent,
      observationId,
      candidateId,
      decisionId,
      proposedPlaceId,
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
      acquiredAt: selected.suggestion.selectedAt ?? materializedAt,
    })
    const marked = await dependencies.store.markMaterialized(suggestionId, materializedAt)
    return {
      schemaVersion: 'place-suggestion-materialization.v1' as const,
      suggestionId,
      status: marked === 'replayed' ? 'replayed' as const : result.status,
      canonicalPlaceId: result.canonicalPlaceId,
    }
  }
}
