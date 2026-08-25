import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordResolutionDecision } from './record-resolution-decision.js'
import {
  recordSuggestionObservation,
  type SuggestedPlaceEvidence,
} from './record-suggestion-observation.js'
import type { CanonicalPlaceMaterializationPort } from './ports/canonical-place-materialization.js'
import type { IngestionStore } from './ports/ingestion-store.js'

const policyVersion = 'interactive-suggestion-materialization.v1'

export async function materializeSuggestedPlace(input: Readonly<{
  input: SuggestedPlaceEvidence
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
}>): Promise<Readonly<{
  status: 'created' | 'linked' | 'replayed'
  canonicalPlaceId: string
}>> {
  const evidence = input.input
  await recordSuggestionObservation(evidence, input.ingestionStore)
  await recordPlaceCandidate({
    id: evidence.candidateId,
    sourceObservationId: evidence.observationId,
    parserVersion: 'place-suggestion.v1',
    name: evidence.name,
    ...(evidence.location === null ? {} : { location: evidence.location }),
    attributes: {
      areaLabel: evidence.areaLabel,
      categoryLabel: evidence.categoryLabel,
      providerKey: evidence.providerKey,
      externalPlaceId: evidence.externalPlaceId,
    },
    createdAt: evidence.acquiredAt,
    store: input.ingestionStore,
  })

  const providerIdentity = {
    providerKey: evidence.providerKey,
    externalPlaceId: evidence.externalPlaceId,
  }
  const existing = await input.canonical.resolveProviderIdentity(providerIdentity)
  const canonicalPlaceId = existing.status === 'linked' ? existing.placeId : evidence.proposedPlaceId
  const replaysOwnCreation = existing.status === 'linked' && existing.placeId === evidence.proposedPlaceId
  await recordResolutionDecision({
    id: evidence.decisionId,
    candidateId: evidence.candidateId,
    decision: existing.status === 'linked' && !replaysOwnCreation
      ? { kind: 'link-place', canonicalPlaceId }
      : { kind: 'create-place', canonicalPlaceId: evidence.proposedPlaceId },
    decidedBy: { kind: 'policy', reference: policyVersion },
    evidenceObservationIds: [evidence.observationId],
    rationale: `personal-intent:${evidence.intent}`,
    decidedAt: evidence.acquiredAt,
    store: input.ingestionStore,
  })

  if (existing.status === 'linked') {
    return { status: replaysOwnCreation ? 'replayed' : 'linked', canonicalPlaceId }
  }

  const outcome = await input.canonical.apply({
    decisionId: evidence.decisionId,
    sourceDecisionId: evidence.decisionId,
    command: { kind: 'create-place', placeId: canonicalPlaceId, providerIdentity },
    policyVersion,
    occurredAt: evidence.acquiredAt,
  })
  if (outcome.status === 'replayed') return { status: 'replayed', canonicalPlaceId }
  if (outcome.status === 'identity-already-linked') {
    const linked = await input.canonical.resolveProviderIdentity(providerIdentity)
    if (linked.status === 'linked') return { status: 'linked', canonicalPlaceId: linked.placeId }
  }
  if (outcome.status !== 'applied') {
    throw new Error(`canonical materialization failed: ${outcome.status}`)
  }
  return { status: 'created', canonicalPlaceId }
}
