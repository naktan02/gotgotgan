import type { CanonicalPlaceMaterializationPort } from '../ports/canonical-place-materialization.js'
import type { IngestionStore } from '../ports/ingestion-store.js'
import { recordResolutionDecision } from '../record-resolution-decision.js'

export class VerifiedProviderPlaceMaterializationRejectedError extends Error {
  override readonly name = 'VerifiedProviderPlaceMaterializationRejectedError'
}

export type VerifiedProviderPlaceMaterialization = Readonly<{
  decisionId: string
  proposedPlaceId: string
  providerKey: string
  externalPlaceId: string
  sourceObservationId: string
  placeCandidateId: string
  occurredAt: string
  policyReference: string
  rationale: string
}>

/** Creates-or-resolves from immutable evidence; never overwrites an existing identity. */
export async function materializeVerifiedProviderPlace(input: Readonly<{
  evidence: VerifiedProviderPlaceMaterialization
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
}>): Promise<Readonly<{ canonicalPlaceId: string; status: 'created' | 'linked' | 'replayed' }>> {
  const evidence = input.evidence
  const identity = {
    providerKey: evidence.providerKey,
    externalPlaceId: evidence.externalPlaceId,
  }
  await recordResolutionDecision({
    id: evidence.decisionId,
    candidateId: evidence.placeCandidateId,
    decision: { kind: 'create-place', canonicalPlaceId: evidence.proposedPlaceId },
    decidedBy: { kind: 'policy', reference: evidence.policyReference },
    evidenceObservationIds: [evidence.sourceObservationId],
    rationale: evidence.rationale,
    decidedAt: evidence.occurredAt,
    store: input.ingestionStore,
  })
  const outcome = await input.canonical.apply({
    decisionId: evidence.decisionId,
    sourceDecisionId: evidence.decisionId,
    command: { kind: 'create-place', placeId: evidence.proposedPlaceId, providerIdentity: identity },
    policyVersion: evidence.policyReference,
    occurredAt: evidence.occurredAt,
  })
  if (!new Set(['applied', 'replayed', 'identity-already-linked']).has(outcome.status)) {
    throw new VerifiedProviderPlaceMaterializationRejectedError(
      `canonical materialization rejected: ${outcome.status}`,
    )
  }
  const resolved = await input.canonical.resolveProviderIdentity(identity)
  if (resolved.status !== 'linked') {
    throw new VerifiedProviderPlaceMaterializationRejectedError(
      'canonical materialization did not resolve the Provider identity',
    )
  }
  return {
    canonicalPlaceId: resolved.placeId,
    status: outcome.status === 'applied'
      ? 'created' : outcome.status === 'replayed' ? 'replayed' : 'linked',
  }
}
