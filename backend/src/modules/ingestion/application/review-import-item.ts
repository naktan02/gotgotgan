import { fingerprint } from './fingerprint.js'
import type { CanonicalPlaceMaterializationPort } from './ports/canonical-place-materialization.js'
import type {
  ImportReviewAction,
  ImportReviewStore,
  ReviewableImportItem,
} from './ports/import-review-store.js'
import type { ImportedPlaceLibraryPort } from './ports/imported-place-library.js'
import type { IngestionStore } from './ports/ingestion-store.js'
import { recordPlaceCandidate } from './record-place-candidate.js'
import { recordResolutionDecision } from './record-resolution-decision.js'
import { recordSourceObservation } from './record-source-observation.js'
import {
  ImportReferenceUnavailableError,
  ImportRequestConflictError,
} from '../domain/imports.js'

const policyVersion = 'connected-import-review.v1'

async function recordEvidence(
  item: ReviewableImportItem,
  action: Exclude<ImportReviewAction, Readonly<{ kind: 'skip'; reason?: string }>>,
  memberId: string,
  occurredAt: string,
  store: IngestionStore,
  canonicalPlaceId: string,
) {
  const externalPlaceId = item.providerPlaceId
  if (externalPlaceId === undefined) {
    throw new ImportReferenceUnavailableError('Provider place identity is unavailable.')
  }
  await recordSourceObservation({
    id: item.observationId,
    providerKey: item.providerKey,
    externalPlaceId,
    acquisitionKind: item.capture.acquisitionKind,
    payloadChecksum: item.capture.checksum,
    parserVersion: item.capture.parserVersion,
    observedAt: item.capture.observedAt,
    acquiredAt: occurredAt,
    captureReference: item.capture.reference,
    facts: {
      name: item.name,
      address: item.address,
      categoryLabel: item.categoryLabel,
      location: item.location,
      listName: item.listName,
    },
    confidence: 0.8,
    store,
  })
  await recordPlaceCandidate({
    id: item.candidateId,
    sourceObservationId: item.observationId,
    parserVersion: item.capture.parserVersion,
    name: item.name,
    ...(item.address === null ? {} : { address: item.address }),
    ...(item.location === null ? {} : { location: item.location }),
    attributes: {
      categoryLabel: item.categoryLabel,
      listName: item.listName,
      providerKey: item.providerKey,
      externalPlaceId,
    },
    createdAt: occurredAt,
    store,
  })
  await recordResolutionDecision({
    id: item.decisionId,
    candidateId: item.candidateId,
    decision: action.kind === 'create-place'
      ? { kind: 'create-place', canonicalPlaceId }
      : { kind: 'link-place', canonicalPlaceId },
    decidedBy: { kind: 'reviewer', reference: memberId },
    evidenceObservationIds: [item.observationId],
    rationale: `connected-import-review:${action.kind}`,
    decidedAt: occurredAt,
    store,
  })
  return { providerKey: item.providerKey, externalPlaceId }
}

export async function reviewImportItem(input: Readonly<{
  memberId: string
  commandId: string
  itemId: string
  action: ImportReviewAction
  occurredAt: string
  reviewStore: ImportReviewStore
  ingestionStore: IngestionStore
  canonical: CanonicalPlaceMaterializationPort
  library: ImportedPlaceLibraryPort
}>) {
  const requestFingerprint = fingerprint({
    memberId: input.memberId,
    itemId: input.itemId,
    action: input.action,
  })
  const begun = await input.reviewStore.beginReview({
    memberId: input.memberId,
    commandId: input.commandId,
    itemId: input.itemId,
    actionKind: input.action.kind,
    requestFingerprint,
    occurredAt: input.occurredAt,
  })
  if (begun.status === 'replayed') return { ...begun.result, status: 'replayed' as const }
  if (begun.status === 'not-found') {
    throw new ImportReferenceUnavailableError('Import item is unavailable.')
  }
  if (begun.status === 'conflict') {
    throw new ImportRequestConflictError('Import review conflicts with an earlier action.')
  }
  if (begun.status === 'invalid') {
    throw new ImportReferenceUnavailableError('Import item cannot perform this action.')
  }
  if (input.action.kind === 'skip') {
    return input.reviewStore.completeReview({
      memberId: input.memberId,
      commandId: input.commandId,
      itemId: input.itemId,
      status: 'skipped',
      completedAt: input.occurredAt,
    })
  }

  const item = begun.item
  const identity = item.providerPlaceId === undefined
    ? undefined
    : { providerKey: item.providerKey, externalPlaceId: item.providerPlaceId }
  if (identity === undefined) {
    throw new ImportReferenceUnavailableError('Provider place identity is unavailable.')
  }
  let canonicalPlaceId: string
  let canonicalCommand
  if (input.action.kind === 'link-place') {
    canonicalPlaceId = input.action.canonicalPlaceId
    canonicalCommand = {
      kind: 'link-provider-identity' as const,
      targetPlaceId: canonicalPlaceId,
      providerIdentity: identity,
    }
  } else {
    const existing = await input.canonical.resolveProviderIdentity(identity)
    canonicalPlaceId = existing.status === 'linked' ? existing.placeId : item.proposedPlaceId
    canonicalCommand = existing.status === 'linked'
      ? undefined
      : {
          kind: 'create-place' as const,
          placeId: canonicalPlaceId,
          providerIdentity: identity,
        }
  }
  await recordEvidence(
    item,
    input.action,
    input.memberId,
    input.occurredAt,
    input.ingestionStore,
    canonicalPlaceId,
  )
  if (canonicalCommand !== undefined) {
    const canonical = await input.canonical.apply({
      decisionId: item.decisionId,
      sourceDecisionId: item.decisionId,
      command: canonicalCommand,
      policyVersion,
      occurredAt: input.occurredAt,
    })
    if (canonical.status === 'identity-already-linked') {
      const linked = await input.canonical.resolveProviderIdentity(identity)
      if (linked.status !== 'linked') {
        throw new ImportReferenceUnavailableError('Provider identity link is unavailable.')
      }
      canonicalPlaceId = linked.placeId
    } else if (canonical.status !== 'applied' && canonical.status !== 'replayed') {
      throw new ImportReferenceUnavailableError(`Canonical review failed: ${canonical.status}`)
    }
  }
  const library = await input.library.saveImportedPlace({
    commandId: input.commandId,
    memberId: input.memberId,
    canonicalPlaceId,
    occurredAt: input.occurredAt,
  })
  if (library.status !== 'applied' && library.status !== 'replayed') {
    throw new ImportReferenceUnavailableError(`Imported place save failed: ${library.status}`)
  }
  return input.reviewStore.completeReview({
    memberId: input.memberId,
    commandId: input.commandId,
    itemId: input.itemId,
    status: 'applied',
    canonicalPlaceId,
    completedAt: input.occurredAt,
  })
}
