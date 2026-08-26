import type { ReviewableImportItem } from './ports/import-review-store.js'
import type { IngestionStore } from './ports/ingestion-store.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordResolutionDecision } from './record-resolution-decision.js'
import { recordSourceObservation } from './record-source-observation.js'
import { ImportReferenceUnavailableError } from '../domain/imports.js'

export async function recordImportedPlaceEvidence(input: Readonly<{
  item: ReviewableImportItem
  canonicalPlaceId: string
  decisionKind: 'create-place' | 'link-place'
  decidedBy: Readonly<{ kind: 'policy' | 'reviewer'; reference: string }>
  rationale: string
  occurredAt: string
  store: IngestionStore
}>) {
  const externalPlaceId = input.item.providerPlaceId
  if (externalPlaceId === undefined) {
    throw new ImportReferenceUnavailableError('Provider place identity is unavailable.')
  }
  await recordSourceObservation({
    id: input.item.observationId,
    providerKey: input.item.providerKey,
    externalPlaceId,
    acquisitionKind: input.item.capture.acquisitionKind,
    payloadChecksum: input.item.capture.checksum,
    parserVersion: input.item.capture.parserVersion,
    observedAt: input.item.capture.observedAt,
    acquiredAt: input.occurredAt,
    captureReference: input.item.capture.reference,
    facts: {
      name: input.item.name,
      address: input.item.address,
      categoryLabel: input.item.categoryLabel,
      location: input.item.location,
      listName: input.item.listName,
    },
    confidence: 0.8,
    store: input.store,
  })
  await recordPlaceCandidate({
    id: input.item.candidateId,
    sourceObservationId: input.item.observationId,
    parserVersion: input.item.capture.parserVersion,
    name: input.item.name,
    ...(input.item.address === null ? {} : { address: input.item.address }),
    ...(input.item.location === null ? {} : { location: input.item.location }),
    attributes: {
      categoryLabel: input.item.categoryLabel,
      listName: input.item.listName,
      providerKey: input.item.providerKey,
      externalPlaceId,
    },
    createdAt: input.occurredAt,
    store: input.store,
  })
  await recordResolutionDecision({
    id: input.item.decisionId,
    candidateId: input.item.candidateId,
    decision: input.decisionKind === 'create-place'
      ? { kind: 'create-place', canonicalPlaceId: input.canonicalPlaceId }
      : { kind: 'link-place', canonicalPlaceId: input.canonicalPlaceId },
    decidedBy: input.decidedBy,
    evidenceObservationIds: [input.item.observationId],
    rationale: input.rationale,
    decidedAt: input.occurredAt,
    store: input.store,
  })
  return { providerKey: input.item.providerKey, externalPlaceId }
}
