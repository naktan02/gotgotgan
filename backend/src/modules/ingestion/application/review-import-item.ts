import { fingerprint } from './fingerprint.js'
import type { CanonicalPlaceMaterializationPort } from './ports/canonical-place-materialization.js'
import type {
  ImportReviewAction,
  ImportReviewStore,
  ReviewableImportItem,
} from './ports/import-review-store.js'
import type { ImportedPlaceLibraryPort } from './ports/imported-place-library.js'
import type { IngestionStore } from './ports/ingestion-store.js'
import { recordImportedPlaceEvidence } from './record-imported-place-evidence.js'
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
  return recordImportedPlaceEvidence({
    item,
    canonicalPlaceId,
    decisionKind: action.kind,
    decidedBy: { kind: 'reviewer', reference: memberId },
    rationale: `connected-import-review:${action.kind}`,
    occurredAt,
    store,
  })
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
