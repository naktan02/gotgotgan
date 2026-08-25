import { fingerprint } from './fingerprint.js'
import { recordSourceObservation } from './record-source-observation.js'
import type { IngestionStore } from './ports/ingestion-store.js'

export type SuggestionObservationEvidence = Readonly<{
  observationId: string
  providerKey: string
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

export type SuggestedPlaceEvidence = SuggestionObservationEvidence & Readonly<{
  intent:
    | 'save'
    | 'wanted'
    | 'visit'
    | 'rating'
    | 'note'
    | 'collection'
    | 'share'
    | 'place-reference'
  candidateId: string
  decisionId: string
  proposedPlaceId: string
}>

export function recordSuggestionObservation(
  input: SuggestionObservationEvidence,
  store: IngestionStore,
) {
  const facts = {
    name: input.name,
    areaLabel: input.areaLabel,
    categoryLabel: input.categoryLabel,
    location: input.location,
    providerPlaceId: input.providerPlaceId,
    sourceKey: input.sourceKey,
  }

  return recordSourceObservation({
    id: input.observationId,
    providerKey: input.providerKey,
    externalPlaceId: input.externalPlaceId,
    acquisitionKind: 'documented-api',
    payloadChecksum: fingerprint(facts),
    parserVersion: 'place-suggestion.v1',
    observedAt: input.observedAt,
    acquiredAt: input.acquiredAt,
    facts,
    confidence: 0.8,
    store,
  })
}
